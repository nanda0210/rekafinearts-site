// Thin sqlite3 → better-sqlite3 shim.
// better-sqlite3 has reliable prebuilts (works on Render's older GLIBC) and
// is faster than sqlite3. Its API is synchronous, so this shim exposes the
// callback-style sqlite3 API on top so existing code keeps working unchanged.
const Database = require("better-sqlite3");

function normParams(p) {
  if (p == null) return [];
  if (Array.isArray(p)) return p;
  if (typeof p === "function") return [];
  return [p];
}

function makeDb(dbPath) {
  const real = new Database(dbPath);
  try { real.pragma("journal_mode = WAL"); } catch {}

  const api = {
    _real: real,

    get(sql, params, cb) {
      if (typeof params === "function") { cb = params; params = []; }
      try {
        const row = real.prepare(sql).get(...normParams(params));
        if (cb) cb(null, row);
      } catch (e) {
        if (cb) cb(e);
      }
    },

    all(sql, params, cb) {
      if (typeof params === "function") { cb = params; params = []; }
      try {
        const rows = real.prepare(sql).all(...normParams(params));
        if (cb) cb(null, rows);
      } catch (e) {
        if (cb) cb(e);
      }
    },

    run(sql, params, cb) {
      if (typeof params === "function") { cb = params; params = []; }
      try {
        // Allow multi-statement DDL (CREATE TABLE; CREATE INDEX; ...)
        const isMulti = /;\s*\S/.test(sql.trim().replace(/;\s*$/, ""));
        if (isMulti && (!params || (Array.isArray(params) && params.length === 0))) {
          real.exec(sql);
          if (cb) cb.call({ lastID: 0, changes: 0 }, null);
          return;
        }
        const stmt = real.prepare(sql);
        const result = stmt.run(...normParams(params));
        if (cb) {
          const ctx = {
            lastID: Number(result.lastInsertRowid || 0),
            changes: result.changes || 0,
          };
          cb.call(ctx, null);
        }
      } catch (e) {
        if (cb) cb.call({}, e);
      }
    },

    // sqlite3 serialize is a no-op here (better-sqlite3 is synchronous).
    serialize(fn) { if (typeof fn === "function") fn(); },

    close() { try { real.close(); } catch {} },
  };

  return api;
}

module.exports = makeDb;
