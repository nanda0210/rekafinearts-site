import fs from "fs";
import path from "path";
import ftp from "basic-ftp";
import dotenv from "dotenv";
import { execSync } from "child_process";

dotenv.config();

const projectDir = "/Users/rajamac/Documents/rprojects/rekafinearts-site";
const distDir = path.join(projectDir, "dist");

const {
  FTP_HOST,
  FTP_USER,
  FTP_PASSWORD,
  FTP_REMOTE_DIR = "public_html",
} = process.env;

if (!FTP_HOST || !FTP_USER || !FTP_PASSWORD) {
  console.error("Missing FTP credentials in .env");
  process.exit(1);
}

function runBuild() {
  console.log("Building project...");
  execSync("npm run build", { cwd: projectDir, stdio: "inherit" });

  if (!fs.existsSync(distDir)) {
    throw new Error("dist folder not found after build.");
  }
}

async function pathExists(client, remotePath) {
  const currentDir = await client.pwd();
  try {
    await client.size(remotePath);
    return "file";
  } catch {}

  try {
    await client.cd(remotePath);
    await client.cd(currentDir);
    return "dir";
  } catch {}

  return null;
}

async function removeIfExists(client, remotePath) {
  const type = await pathExists(client, remotePath);

  if (type === "file") {
    await client.remove(remotePath);
    console.log(`Deleted file: ${remotePath}`);
  } else if (type === "dir") {
    await client.removeDir(remotePath);
    console.log(`Deleted directory: ${remotePath}`);
  }
}

async function uploadFile(client, localPath, remotePath) {
  console.log(`Uploading file: ${remotePath}`);
  await client.uploadFrom(localPath, remotePath);
}

async function uploadDirectory(client, localDir, remoteDir) {
  const parentDir = await client.pwd();

  await client.ensureDir(remoteDir);

  const entries = fs.readdirSync(localDir, { withFileTypes: true });

  for (const entry of entries) {
    const localPath = path.join(localDir, entry.name);

    if (entry.isDirectory()) {
      await client.cd(parentDir);
      await uploadDirectory(client, localPath, `${remoteDir}/${entry.name}`);
    } else {
      await client.cd(parentDir);
      await client.uploadFrom(localPath, `${remoteDir}/${entry.name}`);
      console.log(`Uploading file: ${remoteDir}/${entry.name}`);
    }
  }

  await client.cd(parentDir);
}

async function deploy() {
  const client = new ftp.Client();
  client.ftp.verbose = true;

  try {
    await client.access({
      host: FTP_HOST,
      user: FTP_USER,
      password: FTP_PASSWORD,
      secure: false
    });

    await client.cd("/");
    await client.ensureDir(FTP_REMOTE_DIR);

    await removeIfExists(client, "assets");
    await removeIfExists(client, "index.html");
    await removeIfExists(client, "favicon.svg");
    await removeIfExists(client, "icons.svg");

    const localImagesDir = path.join(distDir, "images");
    if (fs.existsSync(localImagesDir)) {
      await removeIfExists(client, "images");
      console.log("dist/images exists, replacing remote images folder.");
    } else {
      console.log("No dist/images found, keeping remote images folder untouched.");
    }

    const distEntries = fs.readdirSync(distDir, { withFileTypes: true });

    for (const entry of distEntries) {
      const localPath = path.join(distDir, entry.name);
      const remotePath = entry.name;

      if (entry.isDirectory()) {
        if (entry.name === "images" && !fs.existsSync(localImagesDir)) {
          continue;
        }
        await uploadDirectory(client, localPath, remotePath);
      } else {
        await uploadFile(client, localPath, remotePath);
      }
    }

    console.log("Deploy complete.");
  } finally {
    client.close();
  }
}

async function main() {
  runBuild();
  await deploy();
}

main().catch((err) => {
  console.error("Deploy failed:", err.message);
  process.exit(1);
});
