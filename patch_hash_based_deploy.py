from pathlib import Path

PROJECT = Path("/Users/rajamac/Documents/rprojects/rekafinearts-site")
DEPLOY_SERVICE = PROJECT / "scripts" / "deploy-service.mjs"
DEPLOY_MANAGER = PROJECT / "src" / "DeployManager.jsx"

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

function sha256Buffer(buf) {
  const hash = crypto.createHash("sha256");
  hash.update(buf);
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
      note: "Quick FTP login test completed.",
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
          status: "required-with-assets",
        });
      }
    }

    return changed.sort((a, b) => {
      if (a.path === "index.html") return 1;
      if (b.path === "index.html") return -1;
      return a.path.localeCompare(b.path);
    });
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
    const orderedPaths = [...selectedPaths].sort((a, b) => {
      if (a === "index.html") return 1;
      if (b === "index.html") return -1;
      return a.localeCompare(b);
    });

    for (const relPath of orderedPaths) {
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

def patch_deploy_manager():
    text = DEPLOY_MANAGER.read_text(encoding="utf-8")

    if "const [lastUploaded, setLastUploaded] = useState([]);" not in text:
        text = text.replace(
            '  const [toolOutput, setToolOutput] = useState("");\n',
            '  const [toolOutput, setToolOutput] = useState("");\n  const [lastUploaded, setLastUploaded] = useState([]);\n'
        )

    old_upload_success = '''      const data = await fetchJson(`${API_BASE}/api/deploy/upload`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ files: selectedPaths, password: activePassword }),
      });

      setStatus(`Uploaded ${data.uploaded.length} file(s) successfully.`);
      await scan(false);
      await loadLogs();'''

    new_upload_success = '''      const data = await fetchJson(`${API_BASE}/api/deploy/upload`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ files: selectedPaths, password: activePassword }),
      });

      setLastUploaded(data.uploaded || []);
      setStatus(`Uploaded ${data.uploaded.length} file(s) successfully.`);
      await scan(false);
      await loadLogs();'''

    text = text.replace(old_upload_success, new_upload_success)

    marker = '''        <div className="rounded-3xl bg-white shadow-sm ring-1 ring-stone-200">'''
    insert_block = '''        {lastUploaded.length > 0 && (
          <div className="mb-6 rounded-3xl bg-white p-6 shadow-sm ring-1 ring-stone-200">
            <h2 className="text-2xl font-semibold text-stone-900">Last Uploaded Files</h2>
            <div className="mt-4 space-y-2">
              {lastUploaded.map((file) => (
                <div
                  key={file}
                  className="rounded-2xl bg-stone-50 px-4 py-3 text-sm text-stone-700"
                >
                  {file}
                </div>
              ))}
            </div>
          </div>
        )}

'''
    if "Last Uploaded Files" not in text:
        text = text.replace(marker, insert_block + marker, 1)

    DEPLOY_MANAGER.write_text(text, encoding="utf-8")
    print(f"Patched: {DEPLOY_MANAGER}")

def main():
    DEPLOY_SERVICE.write_text(DEPLOY_SERVICE_CODE, encoding="utf-8")
    print(f"Wrote: {DEPLOY_SERVICE}")
    patch_deploy_manager()
    print("\\nDone.")
    print("Next:")
    print("1. restart local manager")
    print("2. open http://localhost:5173/deploy")
    print("3. run Build + Scan")
    print("4. upload selected")
    print("5. hard refresh live page")

if __name__ == "__main__":
    main()
