from pathlib import Path
import json

PROJECT = Path("/Users/rajamac/Documents/rprojects/rekafinearts-site")
DEPLOY_SERVICE = PROJECT / "scripts" / "deploy-service.mjs"
LOCAL_MANAGER = PROJECT / "local-manager.cjs"
DEPLOY_MANAGER = PROJECT / "src" / "DeployManager.jsx"
PACKAGE = PROJECT / "package.json"
WATERMARK_SCRIPT = PROJECT / "scripts" / "watermark-images.py"

DEPLOY_SERVICE_CODE = r'''import fs from "fs";
import path from "path";
import ftp from "basic-ftp";
import dotenv from "dotenv";
import { execSync } from "child_process";
import crypto from "crypto";
import os from "os";

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

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
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
          hash: sha256File(absPath),
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

async function downloadRemoteToTemp(client, relPath) {
  const tmpFile = path.join(
    os.tmpdir(),
    `reka-${Date.now()}-${Math.random().toString(36).slice(2)}-${path.basename(relPath)}`
  );
  await client.downloadTo(tmpFile, remoteAbs(relPath));
  return tmpFile;
}

async function getRemoteHash(client, relPath) {
  const tmpFile = await downloadRemoteToTemp(client, relPath);
  try {
    return sha256File(tmpFile);
  } finally {
    try {
      fs.unlinkSync(tmpFile);
    } catch {}
  }
}

export async function testFtpConnection(ftpPassword) {
  return withClient(async (client) => {
    const pwd = await client.pwd();
    return {
      ok: true,
      remoteDir: pwd,
      note: "FTP login succeeded.",
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
        continue;
      }

      const remoteHash = await getRemoteHash(client, file.path);
      if (remoteHash !== file.hash) {
        changed.push({
          path: file.path,
          size: file.size,
          remoteSize: remote.size,
          status: "content-changed",
        });
      }
    }

    const hasBundleChanges = changed.some((f) =>
      f.path.startsWith("assets/") || f.path.startsWith("images/")
    );

    if (hasBundleChanges && !changed.some((f) => f.path === "index.html")) {
      const indexFile = localFiles.find((f) => f.path === "index.html");
      if (indexFile) {
        const remoteIndex = remoteFiles.get("index.html");
        changed.push({
          path: "index.html",
          size: indexFile.size,
          remoteSize: remoteIndex ? remoteIndex.size : null,
          status: "required-for-live",
        });
      }
    }

    return changed.sort((a, b) => a.path.localeCompare(b.path));
  }, ftpPassword);
}

export async function stageFilesToCpanel(selectedPaths = [], ftpPassword) {
  if (!Array.isArray(selectedPaths) || selectedPaths.length === 0) {
    return [];
  }

  const localFiles = walkLocalFiles(distDir);
  const localMap = new Map(localFiles.map((f) => [f.path, f]));

  const stagePaths = selectedPaths
    .filter((p) => p !== "index.html")
    .sort((a, b) => a.localeCompare(b));

  return withClient(async (client) => {
    const uploaded = [];

    for (const relPath of stagePaths) {
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

export async function promoteIndexLive(ftpPassword) {
  const localIndex = path.join(distDir, "index.html");
  if (!fs.existsSync(localIndex)) {
    throw new Error("dist/index.html not found. Run Build + Scan first.");
  }

  return withClient(async (client) => {
    const remoteIndex = remoteAbs("index.html");
    await client.uploadFrom(localIndex, remoteIndex);
    return {
      uploaded: ["index.html"],
      remotePath: remoteIndex,
    };
  }, ftpPassword);
}
'''

WATERMARK_SCRIPT_CODE = r'''from pathlib import Path
import sys

try:
    from PIL import Image, ImageDraw, ImageFont
except Exception:
    sys.stderr.write("Pillow is required. Install with: pip3 install pillow\n")
    raise

PROJECT = Path("/Users/rajamac/Documents/rprojects/rekafinearts-site")
IMAGES_ROOT = PROJECT / "public" / "images"
BACKUP_ROOT = IMAGES_ROOT / ".watermark-backup"
WATERMARK_TEXT = "Reka Fine Arts"

VALID_EXTS = {".jpg", ".jpeg", ".png", ".webp"}

def is_image(path: Path) -> bool:
    return path.suffix.lower() in VALID_EXTS

def find_images():
    if not IMAGES_ROOT.exists():
        return []
    files = []
    for p in IMAGES_ROOT.rglob("*"):
        if not p.is_file():
            continue
        if BACKUP_ROOT in p.parents:
            continue
        if is_image(p):
            files.append(p)
    return sorted(files)

def ensure_backup(src: Path) -> Path:
    rel = src.relative_to(IMAGES_ROOT)
    backup = BACKUP_ROOT / rel
    backup.parent.mkdir(parents=True, exist_ok=True)
    if not backup.exists():
      backup.write_bytes(src.read_bytes())
    return backup

def add_watermark(src: Path, dst: Path):
    with Image.open(src).convert("RGBA") as base:
        overlay = Image.new("RGBA", base.size, (255, 255, 255, 0))
        draw = ImageDraw.Draw(overlay)

        width, height = base.size
        font_size = max(20, width // 28)

        try:
            font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", font_size)
        except Exception:
            font = ImageFont.load_default()

        bbox = draw.textbbox((0, 0), WATERMARK_TEXT, font=font)
        text_w = bbox[2] - bbox[0]
        text_h = bbox[3] - bbox[1]

        x = width - text_w - max(18, width // 50)
        y = height - text_h - max(18, height // 50)

        pad_x = max(12, width // 120)
        pad_y = max(8, height // 160)

        draw.rounded_rectangle(
            (x - pad_x, y - pad_y, x + text_w + pad_x, y + text_h + pad_y),
            radius=12,
            fill=(0, 0, 0, 85),
        )
        draw.text((x, y), WATERMARK_TEXT, font=font, fill=(255, 255, 255, 155))

        merged = Image.alpha_composite(base, overlay)
        dst.parent.mkdir(parents=True, exist_ok=True)

        if dst.suffix.lower() in {".jpg", ".jpeg"}:
            merged = merged.convert("RGB")
            merged.save(dst, quality=92, optimize=True)
        else:
            merged.save(dst)

def main():
    files = find_images()
    if not files:
        print("No images found under public/images")
        return

    print(f"Found {len(files)} image(s)")
    for path in files:
        backup = ensure_backup(path)
        add_watermark(backup, path)
        print(f"Watermarked: {path.relative_to(IMAGES_ROOT)}")

if __name__ == "__main__":
    main()
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
const refreshImageDataScript = path.join(projectDir, "generate-image-data.py");
const watermarkScript = path.join(projectDir, "scripts", "watermark-images.py");

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

function tailFile(filePath, lines = 60) {
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

function checkPortOpen(port, host = "127.0.0.1", timeout = 500) {
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

    let stderr = "";
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ ok: true, code });
      } else {
        reject(new Error(stderr || `Command failed with code ${code}`));
      }
    });
  });
}

async function getBackendStatus() {
  const pid = readPid();
  const managedRunning = isProcessRunning(pid);
  const portOpen = await checkPortOpen(backendPort);

  let status = "stopped";
  let note = "Backend is not running.";

  if (managedRunning) {
    status = "running";
    note = "Managed backend is running on localhost:3002.";
  } else if (portOpen) {
    status = "running-external";
    note = "Port 3002 is open, but this manager did not start that backend process.";
  }

  return {
    name: "backend",
    status,
    pid: managedRunning ? pid : null,
    port: backendPort,
    portOpen,
    script: backendScript,
    logFile: backendLogFile,
    note,
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

async function getLocalDbMetrics() {
  const exists = fileExists(dbPath);
  const stat = exists ? fs.statSync(dbPath) : null;

  const base = {
    type: "sqlite",
    scope: "local",
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
    note: "This is the local SQLite database used by localhost. It is not the cPanel/live-site database.",
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

function getOnlineDbInfo() {
  const dbName = process.env.REMOTE_DB_NAME || process.env.CPANEL_DB_NAME || null;
  const dbHost = process.env.REMOTE_DB_HOST || process.env.CPANEL_DB_HOST || null;
  const dbType = process.env.REMOTE_DB_TYPE || process.env.CPANEL_DB_TYPE || "unknown";

  if (!dbName && !dbHost) {
    return {
      configured: false,
      scope: "online",
      status: "not-configured",
      note: "Online/cPanel database is not configured here. Add REMOTE_DB_NAME / REMOTE_DB_HOST in .env if you want to document it.",
    };
  }

  return {
    configured: true,
    scope: "online",
    status: "configured",
    dbName: dbName || "-",
    host: dbHost || "-",
    type: dbType,
    note: "This is metadata only. The local manager does not administer the online database directly.",
  };
}

function getUrls() {
  return {
    local: [
      { label: "Frontend", url: "http://localhost:5173" },
      { label: "Preview", url: "http://localhost:4173" },
      { label: "Admin", url: "http://localhost:5173/admin" },
      { label: "Deploy", url: "http://localhost:5173/deploy" },
      { label: "Contact", url: "http://localhost:5173/contact" },
      { label: "Backend API", url: "http://localhost:3002" },
      { label: "Manager API", url: "http://localhost:3003" },
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
    const [backend, localDatabase] = await Promise.all([
      getBackendStatus(),
      getLocalDbMetrics(),
    ]);

    res.json({
      backend,
      localDatabase,
      onlineDatabase: getOnlineDbInfo(),
      urls: getUrls(),
      scripts: {
        refreshImageData: refreshImageDataScript,
        watermarkImages: watermarkScript,
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
      return res.json({ ok: true, message: "Managed backend is already running.", backend: current });
    }
    if (current.status === "running-external") {
      return res.json({ ok: true, message: "Port 3002 is already in use by another backend process.", backend: current });
    }

    const pid = runDetachedNode(backendScript, backendLogFile);
    fs.writeFileSync(backendPidFile, String(pid), "utf8");
    await wait(900);

    res.json({ ok: true, message: "Managed backend started.", backend: await getBackendStatus() });
  } catch (err) {
    res.status(500).json({ error: err.message || "Failed to start backend" });
  }
});

app.post("/api/system/backend/stop", async (req, res) => {
  try {
    const pid = readPid();
    const current = await getBackendStatus();

    if (!pid || !isProcessRunning(pid)) {
      if (fileExists(backendPidFile)) fs.unlinkSync(backendPidFile);
      return res.json({ ok: true, message: "No managed backend process to stop.", backend: current });
    }

    process.kill(pid, "SIGTERM");
    await wait(900);

    if (fileExists(backendPidFile)) fs.unlinkSync(backendPidFile);

    res.json({ ok: true, message: "Managed backend stop requested.", backend: await getBackendStatus() });
  } catch (err) {
    res.status(500).json({ error: err.message || "Failed to stop backend" });
  }
});

app.post("/api/system/backend/restart", async (req, res) => {
  try {
    const pid = readPid();
    if (pid && isProcessRunning(pid)) {
      process.kill(pid, "SIGTERM");
      await wait(900);
    }

    if (fileExists(backendPidFile)) fs.unlinkSync(backendPidFile);

    const newPid = runDetachedNode(backendScript, backendLogFile);
    fs.writeFileSync(backendPidFile, String(newPid), "utf8");
    await wait(900);

    res.json({ ok: true, message: "Managed backend restarted.", backend: await getBackendStatus() });
  } catch (err) {
    res.status(500).json({ error: err.message || "Failed to restart backend" });
  }
});

app.post("/api/system/db/test", async (req, res) => {
  try {
    const metrics = await getLocalDbMetrics();
    if (!metrics.exists) {
      return res.status(404).json({ error: "Local SQLite database file not found", metrics });
    }
    res.json({ ok: true, message: "Local SQLite database is readable.", metrics });
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
    res.json({ ok: true, message: "Database init completed.", metrics: await getLocalDbMetrics() });
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
    res.json({ ok: true, message: "Database seed completed.", metrics: await getLocalDbMetrics() });
  } catch (err) {
    res.status(500).json({ error: err.message || "DB seed failed" });
  }
});

app.post("/api/tools/refresh-image-data", async (req, res) => {
  try {
    if (!fileExists(refreshImageDataScript)) {
      return res.status(404).json({ error: "generate-image-data.py not found" });
    }
    await runProcess("python3", [refreshImageDataScript]);
    res.json({
      ok: true,
      message: "Refresh Image Data completed. Local image metadata has been regenerated.",
      outputTail: tailFile(toolLogFile, 80),
    });
  } catch (err) {
    res.status(500).json({ error: err.message || "Refresh Image Data failed" });
  }
});

app.post("/api/tools/apply-watermark", async (req, res) => {
  try {
    if (!fileExists(watermarkScript)) {
      return res.status(404).json({ error: "watermark-images.py not found" });
    }
    await runProcess("python3", [watermarkScript]);
    res.json({
      ok: true,
      message: "Apply Watermark completed. Local images now include the Reka Fine Arts watermark.",
      outputTail: tailFile(toolLogFile, 80),
    });
  } catch (err) {
    res.status(500).json({ error: err.message || "Apply Watermark failed" });
  }
});

app.post("/api/tools/prepare-images", async (req, res) => {
  try {
    if (!fileExists(watermarkScript)) {
      return res.status(404).json({ error: "watermark-images.py not found" });
    }
    if (!fileExists(refreshImageDataScript)) {
      return res.status(404).json({ error: "generate-image-data.py not found" });
    }

    await runProcess("python3", [watermarkScript]);
    await runProcess("python3", [refreshImageDataScript]);

    res.json({
      ok: true,
      message: "Prepare Images for Publish completed. Watermark applied and image data refreshed.",
      outputTail: tailFile(toolLogFile, 80),
    });
  } catch (err) {
    res.status(500).json({ error: err.message || "Prepare Images for Publish failed" });
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

app.post("/api/deploy/stage", async (req, res) => {
  try {
    const password = req.body?.password;
    const files = Array.isArray(req.body?.files) ? req.body.files : [];

    const { stageFilesToCpanel } = await loadDeployService();
    const uploaded = await stageFilesToCpanel(files, password);

    res.json({
      uploaded,
      updatedAt: new Date().toISOString(),
      message: "cPanel updated",
    });
  } catch (err) {
    res.status(500).json({ error: err.message || "Deploy to cPanel failed" });
  }
});

app.post("/api/deploy/live", async (req, res) => {
  try {
    const password = req.body?.password;

    const { promoteIndexLive } = await loadDeployService();
    const result = await promoteIndexLive(password);

    res.json({
      uploaded: result.uploaded,
      indexUpdatedAt: new Date().toISOString(),
      remotePath: result.remotePath,
      message: "index.html updated live",
    });
  } catch (err) {
    res.status(500).json({ error: err.message || "Live update failed" });
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

function pillClass(status) {
  if (status === "running" || status === "connected" || status === "configured") {
    return "bg-green-100 text-green-700";
  }
  if (status === "stopped" || status === "not-configured") {
    return "bg-stone-200 text-stone-700";
  }
  return "bg-amber-100 text-amber-700";
}

function formatBytes(bytes) {
  if (bytes == null) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatTimestamp(ts) {
  if (!ts) return "-";
  return new Date(ts).toLocaleString();
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  const raw = await res.text();

  let data = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error(`Server returned non-JSON response: ${raw.slice(0, 160)}`);
  }

  if (!res.ok) {
    throw new Error(data.error || data.message || "Request failed");
  }

  return data;
}

function UrlGrid({ title, items = [] }) {
  return (
    <div>
      <h3 className="text-sm font-medium text-stone-700">{title}</h3>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        {items.map((item) => (
          <div key={item.url} className="rounded-2xl bg-stone-50 p-3">
            <p className="text-sm font-medium text-stone-800">{item.label}</p>
            <p className="mt-1 truncate text-xs text-stone-500">{item.url}</p>
            <div className="mt-3 flex gap-2">
              <button
                onClick={() => navigator.clipboard.writeText(item.url)}
                className="rounded-xl border border-stone-300 bg-white px-3 py-2 text-xs text-stone-700"
              >
                Copy
              </button>
              <a
                href={item.url}
                target="_blank"
                rel="noreferrer"
                className="rounded-xl bg-blue-600 px-3 py-2 text-xs text-white"
              >
                Open
              </a>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ActionButton({ onClick, children, color = "bg-stone-900", disabled = false }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`rounded-xl px-4 py-2 text-sm text-white transition hover:opacity-90 disabled:opacity-60 ${color}`}
    >
      {children}
    </button>
  );
}

function ProgressBar({ active, label }) {
  if (!active) return null;

  return (
    <div className="mb-6 rounded-2xl bg-white p-4 ring-1 ring-stone-200">
      <p className="mb-3 text-sm font-medium text-stone-700">{label}</p>
      <div className="h-3 w-full overflow-hidden rounded-full bg-stone-200">
        <div className="h-full w-full animate-pulse rounded-full bg-green-600" />
      </div>
      <p className="mt-2 text-xs text-stone-500">In progress… completes at 100% when the task finishes.</p>
    </div>
  );
}

export default function DeployManager() {
  const [summary, setSummary] = useState(null);
  const [logs, setLogs] = useState({ backendTail: "", toolTail: "" });
  const [files, setFiles] = useState([]);
  const [selected, setSelected] = useState({});
  const [passwordInput, setPasswordInput] = useState("");
  const [activePassword, setActivePassword] = useState("");
  const [status, setStatus] = useState("");
  const [ftpStatus, setFtpStatus] = useState("");
  const [toolOutput, setToolOutput] = useState("");
  const [lastUploaded, setLastUploaded] = useState([]);
  const [cpanelUpdatedAt, setCpanelUpdatedAt] = useState("");
  const [indexUpdatedAt, setIndexUpdatedAt] = useState("");
  const [scanning, setScanning] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [goingLive, setGoingLive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progressActive, setProgressActive] = useState(false);
  const [progressLabel, setProgressLabel] = useState("");

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

  async function refreshAll() {
    try {
      await Promise.all([loadSummary(), loadLogs()]);
      setStatus("Dashboard refreshed.");
    } catch (err) {
      setStatus(err.message || "Failed to load dashboard.");
    }
  }

  useEffect(() => {
    refreshAll();
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

  function submitPassword() {
    if (!passwordInput.trim()) {
      setStatus("Enter the cPanel password first.");
      return;
    }
    setActivePassword(passwordInput);
    setStatus("cPanel password submitted for this local session.");
  }

  function resetPassword() {
    setActivePassword("");
    setPasswordInput("");
    setFtpStatus("");
    setStatus("cPanel password cleared.");
  }

  async function backendStart() {
    await runAction("Starting backend...", async () => {
      const data = await fetchJson(`${API_BASE}/api/system/backend/start`, { method: "POST" });
      setStatus(data.message || "Backend started.");
    });
  }

  async function backendStop() {
    await runAction("Stopping backend...", async () => {
      const data = await fetchJson(`${API_BASE}/api/system/backend/stop`, { method: "POST" });
      setStatus(data.message || "Backend stop requested.");
    });
  }

  async function backendRestart() {
    await runAction("Restarting backend...", async () => {
      const data = await fetchJson(`${API_BASE}/api/system/backend/restart`, { method: "POST" });
      setStatus(data.message || "Backend restarted.");
    });
  }

  async function dbTest() {
    await runAction("Testing local database...", async () => {
      const data = await fetchJson(`${API_BASE}/api/system/db/test`, { method: "POST" });
      setStatus(data.message || "Database test passed.");
    });
  }

  async function dbInit() {
    await runAction("Initializing local database...", async () => {
      const data = await fetchJson(`${API_BASE}/api/system/db/init`, { method: "POST" });
      setStatus(data.message || "Database initialized.");
    });
  }

  async function dbSeed() {
    await runAction("Seeding local database...", async () => {
      const data = await fetchJson(`${API_BASE}/api/system/db/seed`, { method: "POST" });
      setStatus(data.message || "Database seeded.");
    });
  }

  async function refreshImageData() {
    await runAction("Refreshing image data...", async () => {
      const data = await fetchJson(`${API_BASE}/api/tools/refresh-image-data`, { method: "POST" });
      setToolOutput(data.outputTail || "");
      setStatus(data.message || "Refresh Image Data completed.");
    });
  }

  async function applyWatermark() {
    await runAction("Applying watermark...", async () => {
      const data = await fetchJson(`${API_BASE}/api/tools/apply-watermark`, { method: "POST" });
      setToolOutput(data.outputTail || "");
      setStatus(data.message || "Apply Watermark completed.");
    });
  }

  async function prepareImages() {
    await runAction("Preparing images for publish...", async () => {
      const data = await fetchJson(`${API_BASE}/api/tools/prepare-images`, { method: "POST" });
      setToolOutput(data.outputTail || "");
      setStatus(data.message || "Prepare Images for Publish completed.");
    });
  }

  async function testFtp() {
    if (!activePassword) {
      setFtpStatus("Submit the cPanel password first.");
      return;
    }

    setFtpStatus("Testing FTP login...");
    try {
      const data = await fetchJson(`${API_BASE}/api/deploy/test-ftp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: activePassword }),
      });
      setFtpStatus(`${data.note || "FTP ok"} • ${data.remoteDir || ""}`);
    } catch (err) {
      setFtpStatus(err.message || "FTP test failed");
    }
  }

  async function buildAndScan() {
    if (!activePassword) {
      setStatus("Submit the cPanel password first.");
      return;
    }

    setScanning(true);
    setProgressActive(true);
    setProgressLabel("Build started… Build + Scan in progress.");

    try {
      const data = await fetchJson(`${API_BASE}/api/deploy/scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ build: true, password: activePassword }),
      });

      const nextFiles = data.files || [];
      setFiles(nextFiles);

      const nextSelected = {};
      nextFiles.forEach((file) => {
        nextSelected[file.path] = true;
      });
      setSelected(nextSelected);

      setStatus(nextFiles.length ? `Build completed. Found ${nextFiles.length} changed file(s).` : "Build completed. No changed files found.");
    } catch (err) {
      setStatus(err.message || "Build + Scan failed");
    } finally {
      setScanning(false);
      setProgressActive(false);
      setProgressLabel("");
    }
  }

  async function refreshChangedFiles() {
    if (!activePassword) {
      setStatus("Submit the cPanel password first.");
      return;
    }

    setScanning(true);
    setProgressActive(true);
    setProgressLabel("Refresh Changed Files in progress.");

    try {
      const data = await fetchJson(`${API_BASE}/api/deploy/scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ build: false, password: activePassword }),
      });

      const nextFiles = data.files || [];
      setFiles(nextFiles);

      const nextSelected = {};
      nextFiles.forEach((file) => {
        nextSelected[file.path] = true;
      });
      setSelected(nextSelected);

      setStatus(nextFiles.length ? `Refresh completed. Found ${nextFiles.length} changed file(s).` : "Refresh completed. No changed files found.");
    } catch (err) {
      setStatus(err.message || "Refresh Changed Files failed");
    } finally {
      setScanning(false);
      setProgressActive(false);
      setProgressLabel("");
    }
  }

  async function deployToCpanel() {
    if (!activePassword) {
      setStatus("Submit the cPanel password first.");
      return;
    }
    if (!selectedPaths.length) {
      setStatus("Select at least one file.");
      return;
    }

    setDeploying(true);
    setProgressActive(true);
    setProgressLabel("Deploy to cPanel in progress… assets/files will upload before Live.");

    try {
      const data = await fetchJson(`${API_BASE}/api/deploy/stage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files: selectedPaths, password: activePassword }),
      });

      setLastUploaded(data.uploaded || []);
      setCpanelUpdatedAt(data.updatedAt || "");
      setStatus(`cPanel updated at ${formatTimestamp(data.updatedAt)}.`);
      await refreshChangedFiles();
      await loadLogs();
    } catch (err) {
      setStatus(err.message || "Deploy to cPanel failed");
    } finally {
      setDeploying(false);
      setProgressActive(false);
      setProgressLabel("");
    }
  }

  async function goLive() {
    if (!activePassword) {
      setStatus("Submit the cPanel password first.");
      return;
    }

    setGoingLive(true);
    setProgressActive(true);
    setProgressLabel("Live update in progress… uploading public_html/index.html.");

    try {
      const data = await fetchJson(`${API_BASE}/api/deploy/live`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: activePassword }),
      });

      setIndexUpdatedAt(data.indexUpdatedAt || "");
      setLastUploaded(["index.html"]);
      setStatus(`index.html updated live at ${formatTimestamp(data.indexUpdatedAt)}.`);
      await loadLogs();
    } catch (err) {
      setStatus(err.message || "Live update failed");
    } finally {
      setGoingLive(false);
      setProgressActive(false);
      setProgressLabel("");
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
  const localDb = summary?.localDatabase;
  const onlineDb = summary?.onlineDatabase;
  const urls = summary?.urls;

  return (
    <main className="min-h-screen bg-[#faf7f2] p-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h1 className="text-5xl font-semibold tracking-tight text-stone-900">Deploy Manager</h1>
            <p className="mt-3 text-lg text-stone-500">
              Build + Scan → Preview → Refresh Changed Files → Deploy to cPanel → Live
            </p>
          </div>

          <div className="rounded-3xl bg-white p-4 shadow-sm ring-1 ring-stone-200 lg:w-[420px]">
            <label className="mb-2 block text-sm font-medium text-stone-700">cPanel Password</label>
            <div className="flex gap-3">
              <input
                type="password"
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                disabled={!!activePassword}
                className="flex-1 rounded-2xl border border-stone-300 px-4 py-3 disabled:bg-stone-100"
                placeholder="Enter cPanel password"
              />
              <button
                onClick={submitPassword}
                disabled={!!activePassword}
                className="rounded-2xl bg-stone-900 px-4 py-3 text-white disabled:opacity-50"
              >
                Submit
              </button>
            </div>
            <div className="mt-2 flex items-center justify-between">
              <p className="text-xs text-stone-500">After submit, the password field is locked.</p>
              <button
                onClick={resetPassword}
                className="text-xs text-stone-600 underline"
              >
                Reset
              </button>
            </div>
          </div>
        </div>

        <div className="mb-6 overflow-x-auto">
          <div className="flex min-w-max flex-nowrap gap-3">
            <ActionButton onClick={buildAndScan} color="bg-blue-600" disabled={scanning || deploying || goingLive}>
              Build + Scan
            </ActionButton>
            <ActionButton onClick={() => window.open("http://localhost:4173", "_blank")} color="bg-slate-700">
              Preview
            </ActionButton>
            <ActionButton onClick={refreshChangedFiles} color="bg-stone-900" disabled={scanning || deploying || goingLive}>
              Refresh Changed Files
            </ActionButton>
            <ActionButton onClick={deployToCpanel} color="bg-rose-700" disabled={deploying || scanning || goingLive || selectedPaths.length === 0}>
              Deploy to cPanel
            </ActionButton>
            <ActionButton onClick={goLive} color="bg-green-700" disabled={goingLive || scanning || deploying}>
              Live
            </ActionButton>
          </div>
        </div>

        <ProgressBar active={progressActive} label={progressLabel} />

        {status && (
          <div className="mb-6 rounded-2xl bg-white p-4 text-sm text-stone-700 ring-1 ring-stone-200">
            {status}
          </div>
        )}

        <div className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-stone-200">
            <p className="text-sm text-stone-500">Backend</p>
            <div className="mt-3 flex items-center justify-between">
              <span className={`rounded-full px-3 py-1 text-xs font-medium ${pillClass(backend?.status)}`}>
                {backend?.status || "unknown"}
              </span>
              <span className="text-xs text-stone-500">:{backend?.port || 3002}</span>
            </div>
            <p className="mt-3 text-sm text-stone-700">{backend?.note || "-"}</p>
          </div>

          <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-stone-200">
            <p className="text-sm text-stone-500">Local Database</p>
            <div className="mt-3 flex items-center justify-between">
              <span className={`rounded-full px-3 py-1 text-xs font-medium ${pillClass(localDb?.exists ? "connected" : "stopped")}`}>
                {localDb?.exists ? "connected" : "missing"}
              </span>
              <span className="text-xs text-stone-500">{localDb?.dbName || "-"}</span>
            </div>
            <p className="mt-3 text-sm text-stone-700">{localDb?.note || "-"}</p>
          </div>

          <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-stone-200">
            <p className="text-sm text-stone-500">Online Database</p>
            <div className="mt-3 flex items-center justify-between">
              <span className={`rounded-full px-3 py-1 text-xs font-medium ${pillClass(onlineDb?.status)}`}>
                {onlineDb?.status || "unknown"}
              </span>
              <span className="text-xs text-stone-500">{onlineDb?.dbName || onlineDb?.type || "-"}</span>
            </div>
            <p className="mt-3 text-sm text-stone-700">{onlineDb?.note || "-"}</p>
          </div>

          <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-stone-200">
            <p className="text-sm text-stone-500">FTP / Deploy</p>
            <p className="mt-3 text-sm text-stone-700">{ftpStatus || "Not tested yet."}</p>
            <button
              onClick={testFtp}
              className="mt-4 rounded-xl bg-blue-600 px-4 py-2 text-sm text-white"
            >
              Quick FTP Check
            </button>
            <p className="mt-2 text-xs text-stone-500">
              FTP check should be quick. Hash comparison during scan takes longer.
            </p>
          </div>
        </div>

        <div className="mb-6 grid gap-6 xl:grid-cols-2">
          <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-stone-200">
            <h2 className="text-2xl font-semibold text-stone-900">Service Controls</h2>
            <div className="mt-5 space-y-4">
              <div className="rounded-2xl bg-stone-50 p-4">
                <p className="text-sm font-medium text-stone-800">Start Backend</p>
                <p className="mt-1 text-sm text-stone-600">Starts the managed local backend on port 3002 if it is not already running.</p>
                <div className="mt-3"><ActionButton onClick={backendStart} color="bg-green-600" disabled={busy}>Start Backend</ActionButton></div>
              </div>

              <div className="rounded-2xl bg-stone-50 p-4">
                <p className="text-sm font-medium text-stone-800">Stop Backend</p>
                <p className="mt-1 text-sm text-stone-600">Stops only the backend process started by this manager.</p>
                <div className="mt-3"><ActionButton onClick={backendStop} color="bg-stone-700" disabled={busy}>Stop Backend</ActionButton></div>
              </div>

              <div className="rounded-2xl bg-stone-50 p-4">
                <p className="text-sm font-medium text-stone-800">Restart Backend</p>
                <p className="mt-1 text-sm text-stone-600">Restarts the managed backend after backend code changes.</p>
                <div className="mt-3"><ActionButton onClick={backendRestart} color="bg-amber-600" disabled={busy}>Restart Backend</ActionButton></div>
              </div>

              <div className="rounded-2xl bg-stone-50 p-4">
                <p className="text-sm font-medium text-stone-800">Local Database Actions</p>
                <p className="mt-1 text-sm text-stone-600">SQLite is local only here. Test checks readability. Init creates schema. Seed loads data if the scripts exist.</p>
                <div className="mt-3 flex flex-wrap gap-3">
                  <ActionButton onClick={dbTest} color="bg-blue-600" disabled={busy}>Test DB</ActionButton>
                  <ActionButton onClick={dbInit} color="bg-violet-600" disabled={busy}>Init DB</ActionButton>
                  <ActionButton onClick={dbSeed} color="bg-fuchsia-600" disabled={busy}>Seed DB</ActionButton>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-stone-200">
            <h2 className="text-2xl font-semibold text-stone-900">Image Tools</h2>
            <div className="mt-5 space-y-4">
              <div className="rounded-2xl bg-stone-50 p-4">
                <p className="text-sm font-medium text-stone-800">Refresh Image Data</p>
                <p className="mt-1 text-sm text-stone-600">Reads local images and regenerates the metadata file used by the site.</p>
                <div className="mt-3"><ActionButton onClick={refreshImageData} color="bg-rose-700" disabled={busy}>Refresh Image Data</ActionButton></div>
              </div>

              <div className="rounded-2xl bg-stone-50 p-4">
                <p className="text-sm font-medium text-stone-800">Apply Watermark</p>
                <p className="mt-1 text-sm text-stone-600">Adds the “Reka Fine Arts” watermark to local images.</p>
                <div className="mt-3"><ActionButton onClick={applyWatermark} color="bg-stone-900" disabled={busy}>Apply Watermark</ActionButton></div>
              </div>

              <div className="rounded-2xl bg-stone-50 p-4">
                <p className="text-sm font-medium text-stone-800">Prepare Images for Publish</p>
                <p className="mt-1 text-sm text-stone-600">Runs Apply Watermark and Refresh Image Data together before Build + Scan.</p>
                <div className="mt-3"><ActionButton onClick={prepareImages} color="bg-green-700" disabled={busy}>Prepare Images for Publish</ActionButton></div>
              </div>

              <div className="rounded-2xl bg-stone-50 p-4">
                <p className="text-sm font-medium text-stone-800">Tool Output</p>
                <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap text-xs text-stone-600">
                  {toolOutput || logs.toolTail || "No tool output yet."}
                </pre>
              </div>
            </div>
          </div>
        </div>

        <div className="mb-6 grid gap-6 xl:grid-cols-2">
          <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-stone-200">
            <h2 className="text-2xl font-semibold text-stone-900">Database Metrics</h2>

            <div className="mt-5 space-y-5">
              <div className="rounded-2xl bg-stone-50 p-4">
                <p className="text-sm font-medium text-stone-800">Local SQLite Database</p>
                <div className="mt-3 space-y-2 text-sm text-stone-700">
                  <p><span className="font-medium">DB Name:</span> {localDb?.dbName || "-"}</p>
                  <p><span className="font-medium">DB Path:</span> <span className="break-all">{localDb?.dbPath || "-"}</span></p>
                  <p><span className="font-medium">File Size:</span> {localDb?.fileSizeHuman || "-"}</p>
                  <p><span className="font-medium">Last Modified:</span> {localDb?.lastModified || "-"}</p>
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-4">
                  <div className="rounded-2xl bg-white p-3">
                    <p className="text-xs text-stone-500">Tables</p>
                    <p className="mt-2 text-2xl font-semibold text-stone-900">{localDb?.summary?.totalTables ?? 0}</p>
                  </div>
                  <div className="rounded-2xl bg-white p-3">
                    <p className="text-xs text-stone-500">Total Records</p>
                    <p className="mt-2 text-2xl font-semibold text-stone-900">{localDb?.summary?.totalRecordsAcrossTables ?? 0}</p>
                  </div>
                  <div className="rounded-2xl bg-white p-3">
                    <p className="text-xs text-stone-500">Approved</p>
                    <p className="mt-2 text-2xl font-semibold text-green-700">{localDb?.summary?.approvedComments ?? 0}</p>
                  </div>
                  <div className="rounded-2xl bg-white p-3">
                    <p className="text-xs text-stone-500">Pending</p>
                    <p className="mt-2 text-2xl font-semibold text-amber-700">{localDb?.summary?.pendingComments ?? 0}</p>
                  </div>
                </div>

                <div className="mt-4 overflow-hidden rounded-2xl ring-1 ring-stone-200">
                  <div className="grid grid-cols-[1fr_auto] bg-white px-4 py-3 text-sm font-medium text-stone-700">
                    <span>Table</span>
                    <span>Records</span>
                  </div>
                  {(localDb?.tables || []).map((table) => (
                    <div
                      key={table.name}
                      className="grid grid-cols-[1fr_auto] border-t border-stone-200 bg-white px-4 py-3 text-sm text-stone-700"
                    >
                      <span>{table.name}</span>
                      <span>{table.count}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl bg-stone-50 p-4">
                <p className="text-sm font-medium text-stone-800">Online / cPanel Database</p>
                <p className="mt-2 text-sm text-stone-600">{onlineDb?.note || "No online database info configured."}</p>
                {onlineDb?.configured && (
                  <div className="mt-3 space-y-2 text-sm text-stone-700">
                    <p><span className="font-medium">Type:</span> {onlineDb?.type || "-"}</p>
                    <p><span className="font-medium">Host:</span> {onlineDb?.host || "-"}</p>
                    <p><span className="font-medium">DB Name:</span> {onlineDb?.dbName || "-"}</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-stone-200">
            <h2 className="text-2xl font-semibold text-stone-900">URLs</h2>
            <div className="mt-5 space-y-6">
              <UrlGrid title="Local URLs" items={urls?.local || []} />
              <UrlGrid title="Live URLs" items={urls?.live || []} />
            </div>
          </div>
        </div>

        {(lastUploaded.length > 0 || cpanelUpdatedAt || indexUpdatedAt) && (
          <div className="mb-6 rounded-3xl bg-white p-6 shadow-sm ring-1 ring-stone-200">
            <h2 className="text-2xl font-semibold text-stone-900">Last Publish Status</h2>
            <p className="mt-2 text-sm text-stone-600">cPanel updated at: {formatTimestamp(cpanelUpdatedAt)}</p>
            <p className="mt-1 text-sm text-stone-600">index.html updated live: {formatTimestamp(indexUpdatedAt)}</p>
            <div className="mt-4 space-y-2">
              {lastUploaded.map((file) => (
                <div key={file} className="rounded-2xl bg-stone-50 px-4 py-3 text-sm text-stone-700">
                  {file}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="rounded-3xl bg-white shadow-sm ring-1 ring-stone-200">
          <div className="border-b border-stone-200 px-6 py-5">
            <h2 className="text-2xl font-semibold text-stone-900">Changed Files</h2>
            <p className="mt-1 text-sm text-stone-500">
              Deploy to cPanel stages assets/files first. Live uploads public_html/index.html last.
            </p>
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
            <p className="text-sm text-stone-500">{files.length} changed file(s)</p>
          </div>

          {files.length === 0 ? (
            <div className="px-6 py-10 text-sm text-stone-500">No changed files found.</div>
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
                      <span className="font-medium text-amber-700">{file.status}</span>
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
    for p in [DEPLOY_SERVICE, LOCAL_MANAGER, DEPLOY_MANAGER, WATERMARK_SCRIPT]:
        if p.exists():
            backup(p)

    write_file(DEPLOY_SERVICE, DEPLOY_SERVICE_CODE)
    write_file(WATERMARK_SCRIPT, WATERMARK_SCRIPT_CODE)
    write_file(LOCAL_MANAGER, LOCAL_MANAGER_CODE)
    write_file(DEPLOY_MANAGER, DEPLOY_MANAGER_CODE)
    patch_package()

    print("\nDone.")
    print("Next:")
    print("1. npm run manager:start")
    print("2. npm run dev")
    print("3. open http://localhost:5173/deploy")
    print("4. optional: pip3 install pillow")

if __name__ == "__main__":
    main()
