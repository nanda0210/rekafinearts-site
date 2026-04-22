from pathlib import Path
import json
import re

PROJECT = Path("/Users/rajamac/Documents/rprojects/rekafinearts-site")
APP = PROJECT / "src" / "App.jsx"
PACKAGE = PROJECT / "package.json"
LOCAL_MANAGER = PROJECT / "local-manager.cjs"
DEPLOY_MANAGER = PROJECT / "src" / "DeployManager.jsx"
DEPLOY_SERVICE = PROJECT / "scripts" / "deploy-service.mjs"

DEPLOY_SERVICE_CODE = r'''import fs from "fs";
import path from "path";
import ftp from "basic-ftp";
import dotenv from "dotenv";
import { execSync } from "child_process";

dotenv.config();

export const projectDir = "/Users/rajamac/Documents/rprojects/rekafinearts-site";
export const distDir = path.join(projectDir, "dist");

const {
  FTP_HOST,
  FTP_USER,
  FTP_REMOTE_DIR = "public_html",
} = process.env;

if (!FTP_HOST || !FTP_USER) {
  throw new Error("Missing FTP_HOST or FTP_USER in .env");
}

export function runBuild() {
  execSync("npm run build", { cwd: projectDir, stdio: "inherit" });

  if (!fs.existsSync(distDir)) {
    throw new Error("dist folder not found after build.");
  }
}

function toPosix(relPath) {
  return relPath.split(path.sep).join(path.posix.sep);
}

function walkLocalFiles(rootDir) {
  const files = [];

  function walk(currentDir) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const absPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        walk(absPath);
      } else {
        const stat = fs.statSync(absPath);
        const relPath = toPosix(path.relative(rootDir, absPath));
        files.push({
          path: relPath,
          absPath,
          size: stat.size,
          mtimeMs: stat.mtimeMs,
        });
      }
    }
  }

  walk(rootDir);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

function remoteAbs(relPath = "") {
  return relPath
    ? path.posix.join("/", FTP_REMOTE_DIR, relPath)
    : path.posix.join("/", FTP_REMOTE_DIR);
}

async function withClient(fn, ftpPassword) {
  if (!ftpPassword) {
    throw new Error("Missing cPanel password");
  }

  const client = new ftp.Client();
  client.ftp.verbose = false;

  try {
    await client.access({
      host: FTP_HOST,
      user: FTP_USER,
      password: ftpPassword,
      secure: false,
    });

    await client.ensureDir(remoteAbs());
    return await fn(client);
  } finally {
    client.close();
  }
}

async function listRemoteFiles(client, relDir = "") {
  const out = new Map();
  const dir = remoteAbs(relDir);

  let entries = [];
  try {
    entries = await client.list(dir);
  } catch {
    return out;
  }

  for (const entry of entries) {
    const relPath = relDir
      ? path.posix.join(relDir, entry.name)
      : entry.name;

    if (entry.isDirectory) {
      const nested = await listRemoteFiles(client, relPath);
      for (const [k, v] of nested.entries()) out.set(k, v);
    } else {
      out.set(relPath, {
        size: entry.size ?? 0,
        modifiedAt: entry.modifiedAt ? entry.modifiedAt.getTime() : null,
      });
    }
  }

  return out;
}

export async function testFtpConnection(ftpPassword) {
  return withClient(async (client) => {
    const listing = await client.list(remoteAbs());
    return {
      ok: true,
      remoteDir: remoteAbs(),
      itemCount: listing.length,
    };
  }, ftpPassword);
}

export async function scanChangedFiles({ build = true, ftpPassword } = {}) {
  if (build) runBuild();

  const localFiles = walkLocalFiles(distDir);

  return withClient(async (client) => {
    const remoteFiles = await listRemoteFiles(client);
    const changed = [];

    for (const file of localFiles) {
      const remote = remoteFiles.get(file.path);

      if (!remote) {
        changed.push({
          path: file.path,
          size: file.size,
          remoteSize: null,
          status: "missing",
        });
        continue;
      }

      if (remote.size !== file.size) {
        changed.push({
          path: file.path,
          size: file.size,
          remoteSize: remote.size,
          status: "size-changed",
        });
      }
    }

    return changed.sort((a, b) => a.path.localeCompare(b.path));
  }, ftpPassword);
}

export async function uploadSelectedFiles(selectedPaths = [], ftpPassword) {
  if (!Array.isArray(selectedPaths) || selectedPaths.length === 0) {
    return [];
  }

  const localFiles = walkLocalFiles(distDir);
  const localMap = new Map(localFiles.map((f) => [f.path, f]));

  return withClient(async (client) => {
    const uploaded = [];

    for (const relPath of selectedPaths) {
      const local = localMap.get(relPath);
      if (!local) continue;

      const absRemoteFile = remoteAbs(relPath);
      const absRemoteDir = path.posix.dirname(absRemoteFile);

      await client.ensureDir(absRemoteDir);
      await client.uploadFrom(local.absPath, absRemoteFile);
      uploaded.push(relPath);
    }

    return uploaded;
  }, ftpPassword);
}
'''

LOCAL_MANAGER_CODE = r'''const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const net = require("net");
const sqlite3 = require("sqlite3").verbose();
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

  const db = new sqlite3.Database(dbPath);

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
'''

DEPLOY_MANAGER_CODE = r'''import { useEffect, useMemo, useState } from "react";

const API_BASE = "http://localhost:3003";

function statusClass(status) {
  if (status === "running" || status === "ok") return "bg-green-100 text-green-700";
  if (status === "stopped") return "bg-stone-200 text-stone-700";
  return "bg-amber-100 text-amber-700";
}

function formatBytes(bytes) {
  if (bytes == null) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  const raw = await res.text();

  let data = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error(`Server returned non-JSON response: ${raw.slice(0, 120)}`);
  }

  if (!res.ok) {
    throw new Error(data.error || data.message || "Request failed");
  }

  return data;
}

function UrlRow({ label, url }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl bg-stone-50 px-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-stone-800">{label}</p>
        <p className="truncate text-xs text-stone-500">{url}</p>
      </div>
      <div className="flex gap-2">
        <button
          onClick={() => navigator.clipboard.writeText(url)}
          className="rounded-xl border border-stone-300 bg-white px-3 py-2 text-xs text-stone-700"
        >
          Copy
        </button>
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="rounded-xl bg-blue-600 px-3 py-2 text-xs text-white"
        >
          Open
        </a>
      </div>
    </div>
  );
}

export default function DeployManager() {
  const [summary, setSummary] = useState(null);
  const [files, setFiles] = useState([]);
  const [selected, setSelected] = useState({});
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");
  const [ftpStatus, setFtpStatus] = useState("");
  const [scanning, setScanning] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toolOutput, setToolOutput] = useState("");
  const [logs, setLogs] = useState({ backendTail: "", toolTail: "" });

  const selectedPaths = useMemo(
    () => files.filter((f) => selected[f.path]).map((f) => f.path),
    [files, selected]
  );

  const allChecked = files.length > 0 && selectedPaths.length === files.length;

  async function loadSummary() {
    const data = await fetchJson(`${API_BASE}/api/system/summary`);
    setSummary(data);
  }

  async function loadLogs() {
    const data = await fetchJson(`${API_BASE}/api/system/logs`);
    setLogs(data);
  }

  async function initPage() {
    try {
      await Promise.all([loadSummary(), loadLogs()]);
      setStatus("Ready.");
    } catch (err) {
      setStatus(err.message || "Failed to load manager summary.");
    }
  }

  useEffect(() => {
    initPage();
  }, []);

  async function runAction(label, fn) {
    setBusy(true);
    setStatus(label);
    try {
      await fn();
      await Promise.all([loadSummary(), loadLogs()]);
    } catch (err) {
      setStatus(err.message || "Action failed");
    } finally {
      setBusy(false);
    }
  }

  async function backendStart() {
    await runAction("Starting backend...", async () => {
      const data = await fetchJson(`${API_BASE}/api/system/backend/start`, { method: "POST" });
      setStatus(data.message || "Backend started");
    });
  }

  async function backendStop() {
    await runAction("Stopping backend...", async () => {
      const data = await fetchJson(`${API_BASE}/api/system/backend/stop`, { method: "POST" });
      setStatus(data.message || "Backend stop requested");
    });
  }

  async function backendRestart() {
    await runAction("Restarting backend...", async () => {
      const data = await fetchJson(`${API_BASE}/api/system/backend/restart`, { method: "POST" });
      setStatus(data.message || "Backend restarted");
    });
  }

  async function dbTest() {
    await runAction("Testing database...", async () => {
      const data = await fetchJson(`${API_BASE}/api/system/db/test`, { method: "POST" });
      setStatus(data.message || "Database test passed");
    });
  }

  async function dbInit() {
    await runAction("Initializing database...", async () => {
      const data = await fetchJson(`${API_BASE}/api/system/db/init`, { method: "POST" });
      setStatus(data.message || "Database init completed");
    });
  }

  async function dbSeed() {
    await runAction("Seeding database...", async () => {
      const data = await fetchJson(`${API_BASE}/api/system/db/seed`, { method: "POST" });
      setStatus(data.message || "Database seed completed");
    });
  }

  async function runGenerateImageData() {
    await runAction("Running generate-image-data.py...", async () => {
      const data = await fetchJson(`${API_BASE}/api/tools/generate-image-data`, { method: "POST" });
      setToolOutput(data.outputTail || "");
      setStatus(data.message || "generate-image-data.py completed");
    });
  }

  async function testFtp() {
    if (!password.trim()) {
      setFtpStatus("Enter cPanel password first.");
      return;
    }

    setFtpStatus("Testing FTP...");
    try {
      const data = await fetchJson(`${API_BASE}/api/deploy/test-ftp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ password }),
      });

      setFtpStatus(`FTP OK • ${data.remoteDir} • ${data.itemCount} item(s)`);
    } catch (err) {
      setFtpStatus(err.message || "FTP test failed");
    }
  }

  async function scan(build = true) {
    if (!password.trim()) {
      setStatus("Enter cPanel password first.");
      return;
    }

    setScanning(true);
    setStatus(build ? "Building and scanning changed files..." : "Refreshing changed files...");

    try {
      const data = await fetchJson(`${API_BASE}/api/deploy/scan`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ build, password }),
      });

      const nextFiles = data.files || [];
      setFiles(nextFiles);

      const nextSelected = {};
      nextFiles.forEach((file) => {
        nextSelected[file.path] = true;
      });
      setSelected(nextSelected);

      setStatus(
        nextFiles.length
          ? `Found ${nextFiles.length} changed file(s).`
          : "No changed files found."
      );
      await loadSummary();
    } catch (err) {
      setStatus(err.message || "Scan failed");
    } finally {
      setScanning(false);
    }
  }

  async function uploadSelected() {
    if (!password.trim()) {
      setStatus("Enter cPanel password first.");
      return;
    }

    if (selectedPaths.length === 0) {
      setStatus("Select at least one file.");
      return;
    }

    setUploading(true);
    setStatus(`Uploading ${selectedPaths.length} selected file(s)...`);

    try {
      const data = await fetchJson(`${API_BASE}/api/deploy/upload`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ files: selectedPaths, password }),
      });

      setStatus(`Uploaded ${data.uploaded.length} file(s) successfully.`);
      await scan(false);
      await loadLogs();
    } catch (err) {
      setStatus(err.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  function toggleOne(filePath) {
    setSelected((prev) => ({
      ...prev,
      [filePath]: !prev[filePath],
    }));
  }

  function toggleAll() {
    if (allChecked) {
      const cleared = {};
      files.forEach((file) => {
        cleared[file.path] = false;
      });
      setSelected(cleared);
      return;
    }

    const checked = {};
    files.forEach((file) => {
      checked[file.path] = true;
    });
    setSelected(checked);
  }

  const backend = summary?.backend;
  const database = summary?.database;
  const urls = summary?.urls;

  return (
    <main className="min-h-screen bg-[#faf7f2] p-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h1 className="text-5xl font-semibold tracking-tight text-stone-900">Deploy Manager</h1>
            <p className="mt-3 text-lg text-stone-500">
              Local control center for backend, SQLite metrics, deploy scanning, FTP upload, and image-data tooling.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              onClick={initPage}
              disabled={busy || scanning || uploading}
              className="rounded-2xl border border-stone-300 bg-white px-5 py-3 text-stone-700"
            >
              Refresh Status
            </button>
            <button
              onClick={() => scan(true)}
              disabled={busy || scanning || uploading}
              className="rounded-2xl bg-blue-600 px-6 py-3 text-white"
            >
              {scanning ? "Scanning..." : "Build + Scan"}
            </button>
            <button
              onClick={uploadSelected}
              disabled={busy || scanning || uploading || selectedPaths.length === 0}
              className="rounded-2xl bg-rose-700 px-6 py-3 text-white disabled:opacity-60"
            >
              {uploading ? "Uploading..." : `Upload Selected (${selectedPaths.length})`}
            </button>
          </div>
        </div>

        <div className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-stone-200">
            <p className="text-sm text-stone-500">Backend</p>
            <div className="mt-3 flex items-center justify-between">
              <span className={`rounded-full px-3 py-1 text-xs font-medium ${statusClass(backend?.status)}`}>
                {backend?.status || "unknown"}
              </span>
              <span className="text-xs text-stone-500">:{backend?.port || 3002}</span>
            </div>
            <p className="mt-3 text-sm text-stone-700">PID: {backend?.pid || "-"}</p>
            <p className="text-xs text-stone-500">Port open: {String(backend?.portOpen)}</p>
          </div>

          <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-stone-200">
            <p className="text-sm text-stone-500">Database</p>
            <div className="mt-3 flex items-center justify-between">
              <span className={`rounded-full px-3 py-1 text-xs font-medium ${database?.exists ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                {database?.exists ? "connected" : "missing"}
              </span>
              <span className="text-xs text-stone-500">{database?.type || "sqlite"}</span>
            </div>
            <p className="mt-3 text-sm text-stone-700">{database?.dbName || "-"}</p>
            <p className="text-xs text-stone-500">{database?.fileSizeHuman || "-"}</p>
          </div>

          <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-stone-200">
            <p className="text-sm text-stone-500">Deploy Queue</p>
            <p className="mt-3 text-3xl font-semibold text-stone-900">{files.length}</p>
            <p className="text-xs text-stone-500">changed file(s)</p>
          </div>

          <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-stone-200">
            <p className="text-sm text-stone-500">FTP Check</p>
            <p className="mt-3 text-sm text-stone-700 break-words">{ftpStatus || "Not tested yet"}</p>
            <button
              onClick={testFtp}
              className="mt-4 rounded-xl bg-stone-900 px-4 py-2 text-sm text-white"
            >
              Test FTP
            </button>
          </div>
        </div>

        {status && (
          <div className="mb-6 rounded-2xl bg-white p-4 text-sm text-stone-700 ring-1 ring-stone-200">
            {status}
          </div>
        )}

        <div className="mb-6 rounded-3xl bg-white p-6 shadow-sm ring-1 ring-stone-200">
          <label className="mb-2 block text-sm font-medium text-stone-700">
            cPanel Password
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-2xl border border-stone-300 px-4 py-3"
            placeholder="Enter cPanel password"
          />
          <p className="mt-2 text-xs text-stone-500">
            Password is only used for the current local request and is not stored in .env.
          </p>
        </div>

        <div className="mb-6 grid gap-6 xl:grid-cols-2">
          <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-stone-200">
            <h2 className="text-2xl font-semibold text-stone-900">Service Controls</h2>
            <div className="mt-5 flex flex-wrap gap-3">
              <button onClick={backendStart} className="rounded-xl bg-green-600 px-4 py-2 text-white">Start Backend</button>
              <button onClick={backendStop} className="rounded-xl bg-stone-700 px-4 py-2 text-white">Stop Backend</button>
              <button onClick={backendRestart} className="rounded-xl bg-amber-600 px-4 py-2 text-white">Restart Backend</button>
              <button onClick={dbTest} className="rounded-xl bg-blue-600 px-4 py-2 text-white">Test Database</button>
              <button onClick={dbInit} className="rounded-xl bg-violet-600 px-4 py-2 text-white">Initialize DB</button>
              <button onClick={dbSeed} className="rounded-xl bg-fuchsia-600 px-4 py-2 text-white">Seed DB</button>
            </div>

            <div className="mt-6 rounded-2xl bg-stone-50 p-4">
              <p className="text-sm font-medium text-stone-800">Backend log</p>
              <pre className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap text-xs text-stone-600">
                {logs.backendTail || "No backend logs yet."}
              </pre>
            </div>
          </div>

          <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-stone-200">
            <h2 className="text-2xl font-semibold text-stone-900">Tooling</h2>
            <p className="mt-2 text-sm text-stone-500">Run local helper scripts and inspect output.</p>

            <div className="mt-5 flex flex-wrap gap-3">
              <button onClick={runGenerateImageData} className="rounded-xl bg-rose-700 px-4 py-2 text-white">
                Run generate-image-data.py
              </button>
              <button onClick={loadLogs} className="rounded-xl border border-stone-300 bg-white px-4 py-2 text-stone-700">
                Refresh Tool Logs
              </button>
            </div>

            <div className="mt-6 rounded-2xl bg-stone-50 p-4">
              <p className="text-sm font-medium text-stone-800">Tool output</p>
              <pre className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap text-xs text-stone-600">
                {toolOutput || logs.toolTail || "No tool output yet."}
              </pre>
            </div>
          </div>
        </div>

        <div className="mb-6 grid gap-6 xl:grid-cols-2">
          <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-stone-200">
            <h2 className="text-2xl font-semibold text-stone-900">Database Metrics</h2>
            <div className="mt-5 space-y-2 text-sm text-stone-700">
              <p><span className="font-medium">DB Name:</span> {database?.dbName || "-"}</p>
              <p><span className="font-medium">DB Path:</span> <span className="break-all">{database?.dbPath || "-"}</span></p>
              <p><span className="font-medium">File Size:</span> {database?.fileSizeHuman || "-"}</p>
              <p><span className="font-medium">Last Modified:</span> {database?.lastModified || "-"}</p>
              <p className="text-xs text-stone-500">{database?.note || ""}</p>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-4">
              <div className="rounded-2xl bg-stone-50 p-4">
                <p className="text-xs text-stone-500">Tables</p>
                <p className="mt-2 text-2xl font-semibold text-stone-900">{database?.summary?.totalTables ?? 0}</p>
              </div>
              <div className="rounded-2xl bg-stone-50 p-4">
                <p className="text-xs text-stone-500">Total Records</p>
                <p className="mt-2 text-2xl font-semibold text-stone-900">{database?.summary?.totalRecordsAcrossTables ?? 0}</p>
              </div>
              <div className="rounded-2xl bg-stone-50 p-4">
                <p className="text-xs text-stone-500">Approved Comments</p>
                <p className="mt-2 text-2xl font-semibold text-green-700">{database?.summary?.approvedComments ?? 0}</p>
              </div>
              <div className="rounded-2xl bg-stone-50 p-4">
                <p className="text-xs text-stone-500">Pending Comments</p>
                <p className="mt-2 text-2xl font-semibold text-amber-700">{database?.summary?.pendingComments ?? 0}</p>
              </div>
            </div>

            <div className="mt-6 overflow-hidden rounded-2xl ring-1 ring-stone-200">
              <div className="grid grid-cols-[1fr_auto] bg-stone-50 px-4 py-3 text-sm font-medium text-stone-700">
                <span>Table</span>
                <span>Records</span>
              </div>
              {(database?.tables || []).map((table) => (
                <div
                  key={table.name}
                  className="grid grid-cols-[1fr_auto] border-t border-stone-200 px-4 py-3 text-sm text-stone-700"
                >
                  <span>{table.name}</span>
                  <span>{table.count}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-stone-200">
            <h2 className="text-2xl font-semibold text-stone-900">URLs</h2>

            <div className="mt-5">
              <h3 className="text-sm font-medium text-stone-700">Local URLs</h3>
              <div className="mt-3 space-y-3">
                {(urls?.local || []).map((item) => (
                  <UrlRow key={item.url} label={item.label} url={item.url} />
                ))}
              </div>
            </div>

            <div className="mt-6">
              <h3 className="text-sm font-medium text-stone-700">Live URLs</h3>
              <div className="mt-3 space-y-3">
                {(urls?.live || []).map((item) => (
                  <UrlRow key={item.url} label={item.label} url={item.url} />
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-3xl bg-white shadow-sm ring-1 ring-stone-200">
          <div className="flex flex-col gap-4 border-b border-stone-200 px-6 py-5 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-2xl font-semibold text-stone-900">Deploy Files</h2>
              <p className="mt-1 text-sm text-stone-500">Only changed files from dist are listed here.</p>
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                onClick={() => scan(true)}
                disabled={scanning || uploading}
                className="rounded-xl bg-blue-600 px-4 py-2 text-white"
              >
                {scanning ? "Scanning..." : "Build + Scan"}
              </button>
              <button
                onClick={() => scan(false)}
                disabled={scanning || uploading}
                className="rounded-xl border border-stone-300 bg-white px-4 py-2 text-stone-700"
              >
                Refresh Changed Files
              </button>
              <button
                onClick={uploadSelected}
                disabled={uploading || scanning || selectedPaths.length === 0}
                className="rounded-xl bg-rose-700 px-4 py-2 text-white disabled:opacity-60"
              >
                {uploading ? "Uploading..." : `Upload Selected (${selectedPaths.length})`}
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between border-b border-stone-200 px-6 py-4">
            <label className="flex items-center gap-3 text-sm font-medium text-stone-700">
              <input
                type="checkbox"
                checked={allChecked}
                onChange={toggleAll}
                className="h-4 w-4"
              />
              Select all
            </label>

            <p className="text-sm text-stone-500">
              {files.length} changed file(s)
            </p>
          </div>

          {files.length === 0 ? (
            <div className="px-6 py-10 text-sm text-stone-500">
              No changed files to upload.
            </div>
          ) : (
            <div className="divide-y divide-stone-200">
              {files.map((file) => (
                <label
                  key={file.path}
                  className="flex items-center gap-4 px-6 py-4 hover:bg-stone-50"
                >
                  <input
                    type="checkbox"
                    checked={!!selected[file.path]}
                    onChange={() => toggleOne(file.path)}
                    className="h-4 w-4"
                  />

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-stone-800">{file.path}</p>
                    <div className="mt-1 flex flex-wrap gap-3 text-xs text-stone-500">
                      <span>Local: {formatBytes(file.size)}</span>
                      <span>Remote: {formatBytes(file.remoteSize)}</span>
                      <span className={file.status === "missing" ? "font-medium text-blue-600" : "font-medium text-amber-600"}>
                        {file.status}
                      </span>
                    </div>
                  </div>
                </label>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
'''

def backup(path: Path):
    if path.exists():
        backup_path = path.with_suffix(path.suffix + ".bak")
        backup_path.write_text(path.read_text(encoding="utf-8"), encoding="utf-8")
        print(f"Backup created: {backup_path}")

def write_file(path: Path, content: str):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    print(f"Wrote: {path}")

def patch_app():
    if not APP.exists():
        print("src/App.jsx not found. Skipping App patch.")
        return

    backup(APP)
    text = APP.read_text(encoding="utf-8")

    if 'import DeployManager from "./DeployManager";' not in text:
        imports = list(re.finditer(r'^import .+;$', text, flags=re.MULTILINE))
        if imports:
            insert_at = imports[-1].end()
            text = text[:insert_at] + '\nimport DeployManager from "./DeployManager";' + text[insert_at:]
        else:
            text = 'import DeployManager from "./DeployManager";\n' + text

    text = text.replace(
        'const hideHeader = location.pathname === "/admin";',
        'const hideHeader = location.pathname === "/admin" || location.pathname === "/deploy";'
    )

    deploy_route = '<Route path="/deploy" element={<DeployManager />} />'
    admin_route = '<Route path="/admin" element={<Admin />} />'

    if deploy_route not in text:
        if admin_route in text:
            text = text.replace(admin_route, f'{deploy_route}\n          {admin_route}')
        else:
            routes_close = text.rfind("</Routes>")
            if routes_close != -1:
                text = text[:routes_close] + f'          {deploy_route}\n' + text[routes_close:]

    APP.write_text(text, encoding="utf-8")
    print("Patched: src/App.jsx")

def patch_package():
    if not PACKAGE.exists():
        print("package.json not found. Skipping package patch.")
        return

    backup(PACKAGE)
    data = json.loads(PACKAGE.read_text(encoding="utf-8"))
    scripts = data.setdefault("scripts", {})
    scripts["manager:start"] = "node local-manager.cjs"
    PACKAGE.write_text(json.dumps(data, indent=2), encoding="utf-8")
    print("Patched: package.json")

def main():
    write_file(DEPLOY_SERVICE, DEPLOY_SERVICE_CODE)
    write_file(LOCAL_MANAGER, LOCAL_MANAGER_CODE)
    write_file(DEPLOY_MANAGER, DEPLOY_MANAGER_CODE)
    patch_app()
    patch_package()

    print("\nDone.")
    print("Next:")
    print("1. Start local manager:   npm run manager:start")
    print("2. Start backend if needed from the manager page, or run node server.cjs")
    print("3. Start frontend:        npm run dev")
    print("4. Open:                 http://localhost:5173/deploy")

if __name__ == "__main__":
    main()
