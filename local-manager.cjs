const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const net = require("net");
const makeDb = require("./db.cjs");
const { spawn } = require("child_process");
const { pathToFileURL } = require("url");

const app = express();
app.use(cors());
app.use(express.json());

const projectDir = "/Users/rajamac/Documents/rprojects/rekafinearts-site";
const backendScript = path.join(projectDir, "server.cjs");
const backendPort = 3002;
const managerPort = 3003;
const dbPath = path.join(projectDir, "rekafinearts.db");
const initDbScript = path.join(projectDir, "init-db.cjs");
const seedDbScript = path.join(projectDir, "seed-images.cjs");

const generateScriptCandidates = [
  path.join(projectDir, "generate-image-data.py"),
  path.join(projectDir, "generate-image-data.py"),
  path.join(projectDir, "generate_image_data.py"),
];

const logsDir = path.join(projectDir, ".local-manager");
const backendPidFile = path.join(logsDir, "backend.pid");
const backendLogFile = path.join(logsDir, "backend.log");
const toolLogFile = path.join(logsDir, "tools.log");

fs.mkdirSync(logsDir, { recursive: true });

function requireLocalOnly(req, res, next) {
  const ip = req.ip || req.socket?.remoteAddress || "";
  const host = req.headers.host || "";

  const isLocal =
    ip.includes("127.0.0.1") ||
    ip.includes("::1") ||
    host.startsWith("localhost") ||
    host.startsWith("127.0.0.1");

  if (!isLocal) {
    return res.status(403).json({ error: "Local access only" });
  }

  next();
}

app.use(requireLocalOnly);

function fileExists(p) {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

function readPid() {
  if (!fileExists(backendPidFile)) return null;
  const raw = fs.readFileSync(backendPidFile, "utf8").trim();
  const pid = Number(raw);
  return Number.isFinite(pid) ? pid : null;
}

function isProcessRunning(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function detectGenerateScript() {
  return generateScriptCandidates.find((p) => fileExists(p)) || generateScriptCandidates[0];
}

function tailFile(filePath, lines = 50) {
  if (!fileExists(filePath)) return "";
  const content = fs.readFileSync(filePath, "utf8");
  return content.split(/\r?\n/).slice(-lines).join("\n");
}

function formatBytes(bytes) {
  if (bytes == null) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function checkPortOpen(port, host = "127.0.0.1", timeout = 400) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;

    const finish = (result) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(timeout);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.connect(port, host);
  });
}

function runDetachedNode(scriptPath, logFile) {
  const out = fs.openSync(logFile, "a");
  const child = spawn(process.execPath, [scriptPath], {
    cwd: projectDir,
    detached: true,
    stdio: ["ignore", out, out],
    env: process.env,
  });
  child.unref();
  return child.pid;
}

function runProcess(command, args = [], logFile = toolLogFile) {
  return new Promise((resolve, reject) => {
    const out = fs.openSync(logFile, "a");
    const child = spawn(command, args, {
      cwd: projectDir,
      env: process.env,
      stdio: ["ignore", out, out],
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ ok: true, code, stdout, stderr });
      } else {
        reject(new Error(stderr || stdout || `Command failed with code ${code}`));
      }
    });
  });
}

async function getBackendStatus() {
  const pid = readPid();
  const running = isProcessRunning(pid);
  const portOpen = await checkPortOpen(backendPort);

  return {
    name: "backend",
    status: running ? "running" : "stopped",
    pid: running ? pid : null,
    port: backendPort,
    portOpen,
    script: backendScript,
    logFile: backendLogFile,
    tail: tailFile(backendLogFile, 20),
  };
}

function sqliteAll(db, sql) {
  return new Promise((resolve, reject) => {
    db.all(sql, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

function sqliteGet(db, sql) {
  return new Promise((resolve, reject) => {
    db.get(sql, (err, row) => (err ? reject(err) : resolve(row)));
  });
}

async function getDbMetrics() {
  const exists = fileExists(dbPath);
  const stat = exists ? fs.statSync(dbPath) : null;

  const base = {
    type: "sqlite",
    exists,
    dbName: path.basename(dbPath),
    dbPath,
    fileSizeBytes: stat ? stat.size : 0,
    fileSizeHuman: stat ? formatBytes(stat.size) : null,
    lastModified: stat ? stat.mtime.toISOString() : null,
    tables: [],
    summary: {
      totalTables: 0,
      totalRecordsAcrossTables: 0,
      approvedComments: 0,
      pendingComments: 0,
    },
    note: "SQLite is file-based. There is no separate database server to start/stop.",
  };

  if (!exists) return base;

  const db = makeDb(dbPath);

  try {
    const tables = await sqliteAll(
      db,
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
    );

    let totalRecordsAcrossTables = 0;
    const tableRows = [];

    for (const row of tables) {
      const safeName = String(row.name).replace(/"/g, '""');
      const countRow = await sqliteGet(db, `SELECT COUNT(*) AS count FROM "${safeName}"`);
      const count = Number(countRow?.count || 0);
      totalRecordsAcrossTables += count;
      tableRows.push({ name: row.name, count });
    }

    let approvedComments = 0;
    let pendingComments = 0;

    const hasComments = tableRows.some((t) => t.name === "comments");
    if (hasComments) {
      const approved = await sqliteGet(db, `SELECT COUNT(*) AS count FROM comments WHERE approved = 1`);
      const pending = await sqliteGet(db, `SELECT COUNT(*) AS count FROM comments WHERE approved = 0`);
      approvedComments = Number(approved?.count || 0);
      pendingComments = Number(pending?.count || 0);
    }

    return {
      ...base,
      tables: tableRows,
      summary: {
        totalTables: tableRows.length,
        totalRecordsAcrossTables,
        approvedComments,
        pendingComments,
      },
    };
  } finally {
    db.close();
  }
}

function getUrls() {
  return {
    local: [
      { label: "Frontend", url: "http://localhost:5173" },
      { label: "Admin", url: "http://localhost:5173/admin" },
      { label: "Deploy Manager", url: "http://localhost:5173/deploy" },
      { label: "Contact", url: "http://localhost:5173/contact" },
      { label: "Backend API", url: "http://localhost:3002" },
      { label: "Comments API", url: "http://localhost:3002/api/comments" },
      { label: "Local Manager API", url: "http://localhost:3003" },
    ],
    live: [
      { label: "Live Site", url: "https://rekagallery.vip" },
      { label: "Live Contact", url: "https://rekagallery.vip/contact" },
      { label: "Live Admin", url: "https://rekagallery.vip/admin" },
    ],
  };
}

async function loadDeployService() {
  const fileUrl = pathToFileURL(path.join(projectDir, "scripts", "deploy-service.mjs")).href;
  return import(fileUrl);
}

app.get("/api/system/summary", async (req, res) => {
  try {
    const [backend, database] = await Promise.all([
      getBackendStatus(),
      getDbMetrics(),
    ]);

    res.json({
      backend,
      database,
      urls: getUrls(),
      scripts: {
        generateImageData: detectGenerateScript(),
        initDb: initDbScript,
        seedDb: seedDbScript,
      },
      logs: {
        backendLogFile,
        toolLogFile,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message || "Failed to load summary" });
  }
});

app.post("/api/system/backend/start", async (req, res) => {
  try {
    const current = await getBackendStatus();
    if (current.status === "running") {
      return res.json({ ok: true, message: "Backend already running", backend: current });
    }

    const pid = runDetachedNode(backendScript, backendLogFile);
    fs.writeFileSync(backendPidFile, String(pid), "utf8");
    await wait(800);

    res.json({
      ok: true,
      message: "Backend started",
      backend: await getBackendStatus(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message || "Failed to start backend" });
  }
});

app.post("/api/system/backend/stop", async (req, res) => {
  try {
    const pid = readPid();
    if (!pid || !isProcessRunning(pid)) {
      if (fileExists(backendPidFile)) fs.unlinkSync(backendPidFile);
      return res.json({ ok: true, message: "Backend already stopped", backend: await getBackendStatus() });
    }

    process.kill(pid, "SIGTERM");
    await wait(800);

    if (fileExists(backendPidFile)) fs.unlinkSync(backendPidFile);

    res.json({
      ok: true,
      message: "Backend stop requested",
      backend: await getBackendStatus(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message || "Failed to stop backend" });
  }
});

app.post("/api/system/backend/restart", async (req, res) => {
  try {
    const pid = readPid();
    if (pid && isProcessRunning(pid)) {
      process.kill(pid, "SIGTERM");
      await wait(800);
    }

    if (fileExists(backendPidFile)) fs.unlinkSync(backendPidFile);

    const newPid = runDetachedNode(backendScript, backendLogFile);
    fs.writeFileSync(backendPidFile, String(newPid), "utf8");
    await wait(800);

    res.json({
      ok: true,
      message: "Backend restarted",
      backend: await getBackendStatus(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message || "Failed to restart backend" });
  }
});

app.get("/api/system/db/metrics", async (req, res) => {
  try {
    res.json(await getDbMetrics());
  } catch (err) {
    res.status(500).json({ error: err.message || "Failed to load DB metrics" });
  }
});

app.post("/api/system/db/test", async (req, res) => {
  try {
    const metrics = await getDbMetrics();
    if (!metrics.exists) {
      return res.status(404).json({ error: "Database file not found", metrics });
    }
    res.json({ ok: true, message: "Database is readable", metrics });
  } catch (err) {
    res.status(500).json({ error: err.message || "DB test failed" });
  }
});

app.post("/api/system/db/init", async (req, res) => {
  try {
    if (!fileExists(initDbScript)) {
      return res.status(404).json({ error: "init-db.cjs not found" });
    }

    await runProcess(process.execPath, [initDbScript]);
    res.json({ ok: true, message: "Database init completed", metrics: await getDbMetrics() });
  } catch (err) {
    res.status(500).json({ error: err.message || "DB init failed" });
  }
});

app.post("/api/system/db/seed", async (req, res) => {
  try {
    if (!fileExists(seedDbScript)) {
      return res.status(404).json({ error: "seed-images.cjs not found" });
    }

    await runProcess(process.execPath, [seedDbScript]);
    res.json({ ok: true, message: "DB seed completed", metrics: await getDbMetrics() });
  } catch (err) {
    res.status(500).json({ error: err.message || "DB seed failed" });
  }
});

app.post("/api/tools/generate-image-data", async (req, res) => {
  try {
    const scriptPath = detectGenerateScript();

    if (!fileExists(scriptPath)) {
      return res.status(404).json({ error: "generate-image-data.py not found" });
    }

    await runProcess("python3", [scriptPath]);
    res.json({
      ok: true,
      message: "generate-image-data.py completed",
      scriptPath,
      outputTail: tailFile(toolLogFile, 60),
    });
  } catch (err) {
    res.status(500).json({ error: err.message || "Generate image data failed" });
  }
});

app.post("/api/deploy/test-ftp", async (req, res) => {
  try {
    const password = req.body?.password;
    const { testFtpConnection } = await loadDeployService();
    const result = await testFtpConnection(password);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message || "FTP test failed" });
  }
});

app.post("/api/deploy/scan", async (req, res) => {
  try {
    const password = req.body?.password;
    const { scanChangedFiles } = await loadDeployService();
    const files = await scanChangedFiles({
      build: req.body?.build !== false,
      ftpPassword: password,
    });
    res.json({ files });
  } catch (err) {
    res.status(500).json({ error: err.message || "Scan failed" });
  }
});

app.post("/api/deploy/upload", async (req, res) => {
  try {
    const password = req.body?.password;
    const files = Array.isArray(req.body?.files) ? req.body.files : [];

    const { uploadSelectedFiles } = await loadDeployService();
    const uploaded = await uploadSelectedFiles(files, password);

    res.json({ uploaded });
  } catch (err) {
    res.status(500).json({ error: err.message || "Upload failed" });
  }
});

app.get("/api/system/logs", async (req, res) => {
  res.json({
    backendTail: tailFile(backendLogFile, 80),
    toolTail: tailFile(toolLogFile, 80),
    backendLogFile,
    toolLogFile,
  });
});

app.listen(managerPort, () => {
  console.log(`Local manager listening on http://localhost:${managerPort}`);
});
