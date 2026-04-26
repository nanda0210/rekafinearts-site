import { useEffect, useMemo, useState } from "react";

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

// DeployManager is a LOCAL-ONLY tool — it manages the dev box (start/stop
// backend, run DB init, FTP upload). It must not be reachable on the public site.
const IS_LOCAL = (() => {
  const h = typeof window !== "undefined" ? window.location.hostname : "";
  return h === "localhost" || h === "127.0.0.1" || h === "";
})();

export default function DeployManager() {
  if (!IS_LOCAL) return <DeployManagerOffline />;
  return <DeployManagerLocal />;
}

function DeployManagerOffline() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-20 text-center">
      <h2 className="text-2xl font-semibold text-stone-800">Deploy Manager — Local Only</h2>
      <p className="mt-3 text-sm text-stone-600 leading-6">
        This page controls your local development box (start/stop backend, run database init,
        FTP-upload the build). It is intentionally disabled on the live site for security.
      </p>
      <p className="mt-3 text-sm text-stone-500">
        Run it locally at <code className="rounded bg-stone-100 px-2 py-1">http://localhost:5173/deploy</code>.
      </p>
    </div>
  );
}

function DeployManagerLocal() {
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
