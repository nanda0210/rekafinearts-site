import { useEffect, useMemo, useState } from "react";

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
