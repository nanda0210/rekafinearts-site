const { pathToFileURL } = require("url");
const express = require("express");
const cors = require("cors");
const path = require("path");
const nodemailer = require("nodemailer");
const makeDb = require("./db.cjs");

const app = express();
const PORT = parseInt(process.env.PORT || "3002", 10);
const HOST = process.env.PORT ? "0.0.0.0" : "localhost";
const dbPath = path.join(__dirname, "rekafinearts.db");

app.use(cors());
app.use(express.json());
app.use("/images", express.static(path.join(__dirname, "public", "images")));

const db = makeDb(dbPath);

// Email Configuration
// Configure with your Gmail credentials:
// 1. Create an app-specific password at https://myaccount.google.com/apppasswords
// 2. Replace 'your-gmail@gmail.com' with your Gmail address
// 3. Replace 'your-app-password' with the app-specific password
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.ADMIN_EMAIL_USER || "your-gmail@gmail.com",
    pass: process.env.ADMIN_EMAIL_PASS || "your-app-password",
  },
});

// Test email connection
transporter.verify((error, success) => {
  if (error) {
    console.warn("⚠️  Email service not configured. Forgot password will log to console instead.");
    console.warn("To enable email: Set ADMIN_EMAIL_USER and ADMIN_EMAIL_PASS environment variables");
  } else {
    console.log("✅ Email service is ready");
  }
});

app.get("/", (req, res) => {
  res.send("Reka Fine Arts backend is running.");
});

function findImage(category, filename, callback) {
  db.get(
    `SELECT id, filename, category, title, description
     FROM images
     WHERE category = ? AND filename = ?`,
    [category, filename],
    callback
  );
}

app.get("/api/comments", (req, res) => {
  const { category, filename } = req.query;

  if (!category || !filename) {
    return res.status(400).json({ error: "category and filename are required" });
  }

  findImage(category, filename, (err, imageRow) => {
    if (err) return res.status(500).json({ error: "Failed to find image" });
    if (!imageRow) return res.status(404).json({ error: "Image not found" });

    db.all(
      `SELECT id, comment_text, created_at
       FROM comments
       WHERE image_id = ? AND approved = 1
       ORDER BY created_at DESC`,
      [imageRow.id],
      (err2, rows) => {
        if (err2) return res.status(500).json({ error: "Failed to fetch comments" });
        res.json(rows);
      }
    );
  });
});

app.post("/api/comments", (req, res) => {
  const { category, filename, comment_text } = req.body;

  if (!category || !filename || !comment_text) {
    return res
      .status(400)
      .json({ error: "category, filename, and comment_text are required" });
  }

  const trimmed = comment_text.trim();
  if (!trimmed) {
    return res.status(400).json({ error: "Comment cannot be empty" });
  }
  if (trimmed.length > 200) {
    return res.status(400).json({ error: "Comment must be 200 characters or fewer" });
  }

  findImage(category, filename, (err, imageRow) => {
    if (err) return res.status(500).json({ error: "Failed to find image" });
    if (!imageRow) return res.status(404).json({ error: "Image not found" });

    db.run(
      `INSERT INTO comments (image_id, comment_text, approved)
       VALUES (?, ?, 0)`,
      [imageRow.id, trimmed],
      function (err2) {
        if (err2) return res.status(500).json({ error: "Failed to save comment" });

        res.json({
          message: "Comment submitted for approval",
          comment_id: this.lastID,
        });
      }
    );
  });
});

app.get("/api/admin/comments/pending", (req, res) => {
  db.all(
    `SELECT
       c.id,
       c.comment_text,
       c.created_at,
       i.id AS image_id,
       i.filename,
       i.category
     FROM comments c
     JOIN images i ON i.id = c.image_id
     WHERE c.approved = 0
     ORDER BY c.created_at DESC`,
    [],
    (err, rows) => {
      if (err) return res.status(500).json({ error: "Failed to fetch pending comments" });

      const data = rows.map((row) => ({
        ...row,
        imageUrl: `http://localhost:${PORT}/images/${row.category}/${row.filename}`,
      }));

      res.json(data);
    }
  );
});

app.post("/api/admin/comments/:id/approve", (req, res) => {
  const { id } = req.params;

  db.run(
    `UPDATE comments SET approved = 1 WHERE id = ?`,
    [id],
    function (err) {
      if (err) return res.status(500).json({ error: "Failed to approve comment" });
      res.json({ message: "Comment approved" });
    }
  );
});

app.post("/api/admin/comments/:id/reject", (req, res) => {
  const { id } = req.params;

  db.run(
    `DELETE FROM comments WHERE id = ?`,
    [id],
    function (err) {
      if (err) return res.status(500).json({ error: "Failed to reject comment" });
      res.json({ message: "Comment rejected" });
    }
  );
});

// ========== ADMIN AUTHENTICATION ENDPOINTS ==========

// Admin Login
app.post("/api/admin/login", (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: "Username and password are required" });
  }

  db.get(
    `SELECT id, username, email FROM admin WHERE username = ? AND password = ?`,
    [username, password],
    (err, row) => {
      if (err) return res.status(500).json({ error: "Database error" });
      if (!row) return res.status(401).json({ error: "Invalid credentials" });

      res.json({
        success: true,
        message: "Login successful",
        admin: row,
      });
    }
  );
});

// Change Password
app.post("/api/admin/change-password", (req, res) => {
  const { username, oldPassword, newPassword } = req.body;

  if (!username || !oldPassword || !newPassword) {
    return res.status(400).json({ error: "All fields are required" });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({ error: "New password must be at least 6 characters" });
  }

  db.run(
    `UPDATE admin SET password = ?, updated_at = CURRENT_TIMESTAMP 
     WHERE username = ? AND password = ?`,
    [newPassword, username, oldPassword],
    function (err) {
      if (err) return res.status(500).json({ error: "Database error" });
      if (this.changes === 0) {
        return res.status(401).json({ error: "Invalid username or old password" });
      }

      res.json({ message: "Password changed successfully" });
    }
  );
});

// Forgot Password - Send to Email
app.post("/api/admin/forgot-password", (req, res) => {
  const { username } = req.body;

  if (!username) {
    return res.status(400).json({ error: "Username is required" });
  }

  db.get(
    `SELECT username, password, email FROM admin WHERE username = ?`,
    [username],
    (err, row) => {
      if (err) return res.status(500).json({ error: "Database error" });
      if (!row) return res.status(404).json({ error: "Admin user not found" });

      const adminEmail = row.email || "nanda73@yahoo.com";
      const emailBody = `
        <h2>Password Reset Request</h2>
        <p>Hi ${row.username},</p>
        <p>Here is your admin password:</p>
        <p><strong>${row.password}</strong></p>
        <p>Please keep this password secure and consider changing it after login.</p>
        <p>If you did not request this, please ignore this email.</p>
      `;

      const mailOptions = {
        from: "noreply@rekafinearts.com",
        to: adminEmail,
        subject: "Reka Fine Arts - Admin Password Reset",
        html: emailBody,
      };

      transporter.sendMail(mailOptions, (error, info) => {
        if (error) {
          console.error("📧 Email Error:", error.message);
          console.log("🔐 Password Recovery (Console):", row.password);
          
          // Fallback: Still consider it successful and inform user
          return res.status(200).json({
            message: `Password reset initiated. Check email at ${adminEmail}.`,
            email: adminEmail.replace(/(.{2})(.*)(@.*)/, "$1***$3"),
            warning: "Note: Email service may not be configured. Check server console for password.",
          });
        }

        console.log("✅ Email sent:", info.response);
        res.json({
          message: "Password has been sent to your email",
          email: adminEmail.replace(/(.{2})(.*)(@.*)/, "$1***$3"),
        });
      });
    }
  );
});

// ========== COMMENT MANAGEMENT ENDPOINTS ==========

// Get All Comments (for admin)
app.get("/api/comments/all", (req, res) => {
  db.all(
    `SELECT
       c.id,
       c.comment_text,
       c.approved,
       c.created_at,
       i.filename,
       i.category
     FROM comments c
     JOIN images i ON i.id = c.image_id
     ORDER BY c.created_at DESC`,
    [],
    (err, rows) => {
      if (err) return res.status(500).json({ error: "Failed to fetch comments" });
      res.json(rows);
    }
  );
});

// Delete Comment
app.delete("/api/admin/comments/:id", (req, res) => {
  const { id } = req.params;

  db.run(
    `DELETE FROM comments WHERE id = ?`,
    [id],
    function (err) {
      if (err) return res.status(500).json({ error: "Failed to delete comment" });
      res.json({ message: "Comment deleted successfully" });
    }
  );
});

// Update Comment
app.put("/api/admin/comments/:id", (req, res) => {
  const { id } = req.params;
  const { comment_text } = req.body;

  if (!comment_text) {
    return res.status(400).json({ error: "Comment text is required" });
  }

  db.run(
    `UPDATE comments SET comment_text = ? WHERE id = ?`,
    [comment_text, id],
    function (err) {
      if (err) return res.status(500).json({ error: "Failed to update comment" });
      res.json({ message: "Comment updated successfully" });
    }
  );
});

// BEGIN_DEPLOY_MANAGER_LOCAL
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


app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});