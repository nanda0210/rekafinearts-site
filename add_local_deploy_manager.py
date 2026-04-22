from pathlib import Path
import re

PROJECT = Path("/Users/rajamac/Documents/rprojects/rekafinearts-site")
SERVER = PROJECT / "server.cjs"
APP = PROJECT / "src" / "App.jsx"
DEPLOY_SERVICE = PROJECT / "scripts" / "deploy-service.mjs"
DEPLOY_MANAGER = PROJECT / "src" / "DeployManager.jsx"

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

DEPLOY_MANAGER_CODE = r'''import { useEffect, useMemo, useState } from "react";

const API_BASE = "http://localhost:3002";

function formatBytes(bytes) {
  if (bytes == null) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export default function DeployManager() {
  const [password, setPassword] = useState("");
  const [files, setFiles] = useState([]);
  const [selected, setSelected] = useState({});
  const [scanning, setScanning] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [status, setStatus] = useState("");

  const selectedPaths = useMemo(
    () => files.filter((f) => selected[f.path]).map((f) => f.path),
    [files, selected]
  );

  const allChecked = files.length > 0 && selectedPaths.length === files.length;

  async function scan(build = true) {
    if (!password.trim()) {
      setStatus("Enter cPanel password first.");
      return;
    }

    setScanning(true);
    setStatus(build ? "Building and scanning changed files..." : "Refreshing changed files...");

    try {
      const res = await fetch(`${API_BASE}/api/deploy/scan`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ build, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Scan failed");
      }

      const nextFiles = data.files || [];
      setFiles(nextFiles);

      const nextSelected = {};
      nextFiles.forEach((file) => {
        nextSelected[file.path] = true;
      });
      setSelected(nextSelected);

      setStatus(
        nextFiles.length
          ? `Found ${nextFiles.length} changed files.`
          : "No changed files found."
      );
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
    setStatus(`Uploading ${selectedPaths.length} selected files...`);

    try {
      const res = await fetch(`${API_BASE}/api/deploy/upload`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ files: selectedPaths, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Upload failed");
      }

      setStatus(`Uploaded ${data.uploaded.length} file(s) successfully.`);
      await scan(false);
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

  useEffect(() => {
    setStatus("Enter cPanel password, then click Build + Scan.");
  }, []);

  return (
    <main className="min-h-screen bg-[#faf7f2] p-10">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold text-stone-800">Deploy Manager</h1>
            <p className="mt-2 text-sm text-stone-500">
              Local-only page. Builds dist, shows changed files, and uploads only the selected ones.
            </p>
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => scan(true)}
              disabled={scanning || uploading}
              className="rounded-xl bg-blue-600 px-5 py-3 text-white transition hover:opacity-90 disabled:opacity-60"
            >
              {scanning ? "Scanning..." : "Build + Scan"}
            </button>

            <button
              onClick={uploadSelected}
              disabled={uploading || scanning || selectedPaths.length === 0}
              className="rounded-xl bg-rose-700 px-5 py-3 text-white transition hover:opacity-90 disabled:opacity-60"
            >
              {uploading ? "Uploading..." : `Upload Selected (${selectedPaths.length})`}
            </button>
          </div>
        </div>

        <div className="mb-6 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-stone-200">
          <label className="mb-2 block text-sm font-medium text-stone-700">
            cPanel Password
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-xl border border-stone-300 px-4 py-3"
            placeholder="Enter cPanel password"
          />
        </div>

        {status && (
          <div className="mb-6 rounded-2xl bg-white p-4 text-sm text-stone-700 ring-1 ring-stone-200">
            {status}
          </div>
        )}

        <div className="overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-stone-200">
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
                    <p className="truncate text-sm font-medium text-stone-800">
                      {file.path}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-3 text-xs text-stone-500">
                      <span>Local: {formatBytes(file.size)}</span>
                      <span>Remote: {formatBytes(file.remoteSize)}</span>
                      <span
                        className={
                          file.status === "missing"
                            ? "font-medium text-blue-600"
                            : "font-medium text-amber-600"
                        }
                      >
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

SERVER_BLOCK = r'''// BEGIN_DEPLOY_MANAGER_LOCAL
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

async function loadDeployService() {
  const fileUrl = pathToFileURL(
    path.join(__dirname, "scripts", "deploy-service.mjs")
  ).href;

  return import(fileUrl);
}

app.post("/api/deploy/scan", requireLocalOnly, async (req, res) => {
  try {
    const ftpPassword = req.body?.password;

    const { scanChangedFiles } = await loadDeployService();
    const files = await scanChangedFiles({
      build: req.body?.build !== false,
      ftpPassword,
    });

    res.json({ files });
  } catch (err) {
    console.error("Deploy scan failed:", err);
    res.status(500).json({ error: err.message || "Scan failed" });
  }
});

app.post("/api/deploy/upload", requireLocalOnly, async (req, res) => {
  try {
    const files = Array.isArray(req.body?.files) ? req.body.files : [];
    const ftpPassword = req.body?.password;

    if (files.length === 0) {
      return res.status(400).json({ error: "No files selected" });
    }

    const { uploadSelectedFiles } = await loadDeployService();
    const uploaded = await uploadSelectedFiles(files, ftpPassword);

    res.json({ uploaded });
  } catch (err) {
    console.error("Deploy upload failed:", err);
    res.status(500).json({ error: err.message || "Upload failed" });
  }
});
// END_DEPLOY_MANAGER_LOCAL
'''

def backup(path: Path):
    backup_path = path.with_suffix(path.suffix + ".bak")
    backup_path.write_text(path.read_text(encoding="utf-8"), encoding="utf-8")
    print(f"Backup created: {backup_path}")

def write_file(path: Path, content: str):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    print(f"Written: {path}")

def patch_server():
    if not SERVER.exists():
        raise FileNotFoundError(f"Missing {SERVER}")

    backup(SERVER)
    text = SERVER.read_text(encoding="utf-8")

    if 'const path = require("path");' not in text:
        text = 'const path = require("path");\n' + text

    if 'const { pathToFileURL } = require("url");' not in text:
        text = 'const { pathToFileURL } = require("url");\n' + text

    if SERVER_BLOCK not in text:
        match = re.search(r'app\.listen\s*\(', text)
        if match:
            insert_at = match.start()
            text = text[:insert_at] + SERVER_BLOCK + "\n\n" + text[insert_at:]
        else:
            text += "\n\n" + SERVER_BLOCK + "\n"

    SERVER.write_text(text, encoding="utf-8")
    print(f"Patched: {SERVER}")

def patch_app():
    if not APP.exists():
        raise FileNotFoundError(f"Missing {APP}")

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

    if '<Route path="/deploy" element={<DeployManager />} />' not in text:
        admin_route = '<Route path="/admin" element={<Admin />} />'
        deploy_route = '<Route path="/deploy" element={<DeployManager />} />\n          <Route path="/admin" element={<Admin />} />'
        if admin_route in text:
            text = text.replace(admin_route, deploy_route)
        else:
            routes_close = text.rfind("</Routes>")
            if routes_close != -1:
                text = text[:routes_close] + '          <Route path="/deploy" element={<DeployManager />} />\n' + text[routes_close:]

    APP.write_text(text, encoding="utf-8")
    print(f"Patched: {APP}")

def main():
    write_file(DEPLOY_SERVICE, DEPLOY_SERVICE_CODE)
    write_file(DEPLOY_MANAGER, DEPLOY_MANAGER_CODE)
    patch_server()
    patch_app()

    print("\nDone.")
    print("Next steps:")
    print("1. restart your local backend server")
    print("2. restart your Vite frontend")
    print("3. open http://localhost:5173/deploy")
    print("4. enter cPanel password, click Build + Scan, then Upload Selected")

if __name__ == "__main__":
    main()
