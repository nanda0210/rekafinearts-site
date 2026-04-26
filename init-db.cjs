const path = require("path");
const makeDb = require("./db.cjs");

const dbPath = path.join(__dirname, "rekafinearts.db");
const db = makeDb(dbPath);

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL UNIQUE,
      category TEXT NOT NULL,
      title TEXT,
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS likes (
      image_id INTEGER PRIMARY KEY,
      count INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (image_id) REFERENCES images(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      image_id INTEGER NOT NULL,
      comment_text TEXT NOT NULL,
      approved INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (image_id) REFERENCES images(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS admin (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      email TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Insert default admin or update existing admin credentials
  db.run(
    `INSERT INTO admin (username, password, email) VALUES (?, ?, ?)
     ON CONFLICT(username) DO UPDATE SET password = excluded.password, email = excluded.email, updated_at = CURRENT_TIMESTAMP`,
    ["admin", "admin", "nanda73@yahoo.com"],
    function(err) {
      if (err) {
        console.error("Error inserting or updating default admin:", err);
      }
    }
  );

  console.log("Database initialized:", dbPath);
});

db.close();