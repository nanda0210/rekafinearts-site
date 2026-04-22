from pathlib import Path

project = Path("/Users/rajamac/Documents/rprojects/rekafinearts-site")
manager = project / "local-manager.cjs"

text = manager.read_text(encoding="utf-8")

load_helper = '''async function loadDeployService() {
  const fileUrl = pathToFileURL(path.join(projectDir, "scripts", "deploy-service.mjs")).href;
  return import(fileUrl);
}
'''

routes_block = '''
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
'''

if 'async function loadDeployService()' not in text:
    listen_idx = text.rfind('app.listen(')
    if listen_idx == -1:
        raise SystemExit("Could not find app.listen(...) in local-manager.cjs")
    text = text[:listen_idx] + load_helper + "\n" + text[listen_idx:]

if '/api/deploy/stage' not in text:
    listen_idx = text.rfind('app.listen(')
    if listen_idx == -1:
        raise SystemExit("Could not find app.listen(...) in local-manager.cjs")
    text = text[:listen_idx] + "\n" + routes_block + "\n" + text[listen_idx:]

manager.write_text(text, encoding="utf-8")
print("Patched local-manager.cjs")
