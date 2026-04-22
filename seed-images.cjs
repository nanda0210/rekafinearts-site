const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();

const projectRoot = __dirname;
const dbPath = path.join(projectRoot, "rekafinearts.db");
const imagesRoot = path.join(projectRoot, "public", "images");

const categoryMap = {
  gallery: "gallery",
  advanced: "advanced",
  intermediate: "intermediate",
  beginners: "beginners",
  kidsart: "kidsart",
  "hero-open": "hero-open",
};

const allowedExts = new Set([
  ".jpg", ".jpeg", ".png", ".webp", ".gif",
  ".JPG", ".JPEG", ".PNG", ".WEBP", ".GIF",
]);

const db = new sqlite3.Database(dbPath);

function getFilesFromCategory(folderPath) {
  if (!fs.existsSync(folderPath)) return [];
  return fs
    .readdirSync(folderPath)
    .filter((file) => {
      const fullPath = path.join(folderPath, file);
      return fs.statSync(fullPath).isFile() && allowedExts.has(path.extname(file));
    })
    .sort();
}

const jobs = [];

for (const [folderName, category] of Object.entries(categoryMap)) {
  const folderPath = path.join(imagesRoot, folderName);
  const files = getFilesFromCategory(folderPath);

  files.forEach((file) => {
    jobs.push({ file, category });
  });
}

if (jobs.length === 0) {
  console.log("No images found to seed.");
  db.close();
} else {
  let pending = jobs.length;

  function done() {
    pending -= 1;
    if (pending === 0) {
      db.close((err) => {
        if (err) {
          console.error("Error closing DB:", err.message);
        } else {
          console.log("Image seeding completed.");
        }
      });
    }
  }

  jobs.forEach(({ file, category }) => {
    const defaultTitle = path.parse(file).name;
    const defaultDescription = `Image from ${category} category`;

    db.run(
      `
      INSERT OR IGNORE INTO images (filename, category, title, description)
      VALUES (?, ?, ?, ?)
      `,
      [file, category, defaultTitle, defaultDescription],
      (err) => {
        if (err) {
          console.error(`Error inserting image ${file}:`, err.message);
          done();
          return;
        }

        db.get(
          `SELECT id FROM images WHERE filename = ? AND category = ?`,
          [file, category],
          (err2, row) => {
            if (err2) {
              console.error(`Error fetching image row for ${file}:`, err2.message);
              done();
              return;
            }

            if (!row) {
              done();
              return;
            }

            db.run(
              `INSERT OR IGNORE INTO likes (image_id, count) VALUES (?, 0)`,
              [row.id],
              (err3) => {
                if (err3) {
                  console.error(`Error inserting likes row for ${file}:`, err3.message);
                }
                done();
              }
            );
          }
        );
      }
    );
  });
}