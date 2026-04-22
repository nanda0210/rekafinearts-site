from pathlib import Path

p = Path("/Users/rajamac/Documents/rprojects/rekafinearts-site/scripts/deploy-service.mjs")
text = p.read_text(encoding="utf-8")

old_scan = '''    for (const file of localFiles) {
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

    return changed.sort((a, b) => a.path.localeCompare(b.path));'''

new_scan = '''    for (const file of localFiles) {
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
    });'''

old_upload = '''    for (const relPath of selectedPaths) {
      const local = localMap.get(relPath);
      if (!local) continue;

      const absRemoteFile = remoteAbs(relPath);
      const absRemoteDir = path.posix.dirname(absRemoteFile);

      await client.ensureDir(absRemoteDir);
      await client.uploadFrom(local.absPath, absRemoteFile);
      uploaded.push(relPath);
    }'''

new_upload = '''    const orderedPaths = [...selectedPaths].sort((a, b) => {
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
    }'''

if old_scan not in text:
    raise SystemExit("Could not find scanChangedFiles block to patch.")

if old_upload not in text:
    raise SystemExit("Could not find uploadSelectedFiles block to patch.")

text = text.replace(old_scan, new_scan, 1)
text = text.replace(old_upload, new_upload, 1)

p.write_text(text, encoding="utf-8")
print("Patched deploy-service.mjs successfully.")
