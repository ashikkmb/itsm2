// ── Promise wrapper around node 'sqlite3' ──────────────────────────────────────
// Provides db.get(sql, params), db.all(sql, params), db.run(sql, params) as
// promises, plus db.exec(sql) for multi-statement DDL.

const sqlite3 = require("sqlite3").verbose();

function wrap(filepath) {
  const raw = new sqlite3.Database(filepath);
  raw.configure("busyTimeout", 5000);

  const db = {
    raw,

    exec(sql) {
      return new Promise((resolve, reject) => {
        raw.exec(sql, (err) => (err ? reject(err) : resolve()));
      });
    },

    get(sql, params = []) {
      return new Promise((resolve, reject) => {
        raw.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
      });
    },

    all(sql, params = []) {
      return new Promise((resolve, reject) => {
        raw.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
      });
    },

    run(sql, params = []) {
      return new Promise((resolve, reject) => {
        raw.run(sql, params, function (err) {
          if (err) return reject(err);
          resolve({ lastInsertRowid: this.lastID, changes: this.changes });
        });
      });
    },

    pragma(stmt) {
      return db.exec(`PRAGMA ${stmt}`);
    },
  };

  return db;
}

module.exports = { wrap };
