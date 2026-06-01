/* ===================================================================
   Attira — waitlist database (SQLite via better-sqlite3)
   One table that retains every email submitted through the landing
   page's "Get early access" form so you can reach out to people later.
   The DB file lives at data/waitlist.db (created automatically).
   =================================================================== */

const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, "waitlist.db");

// Make sure the data folder exists before opening the database.
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL"); // safer concurrent writes

// email is UNIQUE + COLLATE NOCASE so the same address can't be stored
// twice regardless of capitalisation.
db.exec(`
  CREATE TABLE IF NOT EXISTS waitlist (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    email       TEXT    UNIQUE NOT NULL COLLATE NOCASE,
    source      TEXT    DEFAULT 'website',
    user_agent  TEXT,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_waitlist_created_at ON waitlist(created_at);
`);

const stmts = {
  insert: db.prepare(
    "INSERT INTO waitlist (email, source, user_agent) VALUES (?, ?, ?)"
  ),
  findByEmail: db.prepare("SELECT id FROM waitlist WHERE email = ?"),
  count: db.prepare("SELECT COUNT(*) AS n FROM waitlist"),
  all: db.prepare(
    "SELECT id, email, source, user_agent, created_at FROM waitlist ORDER BY id ASC"
  ),
};

// Store an email. Idempotent: re-submitting the same address is a no-op
// and reports back as "existing" rather than throwing.
function addEmail({ email, source, userAgent }) {
  const clean = String(email || "").trim().toLowerCase();

  if (stmts.findByEmail.get(clean)) {
    return { status: "existing", email: clean };
  }

  try {
    stmts.insert.run(clean, source || "website", (userAgent || "").slice(0, 255));
    return { status: "created", email: clean };
  } catch (err) {
    // A race could still trip the UNIQUE constraint — treat as existing.
    if (err && err.code === "SQLITE_CONSTRAINT_UNIQUE") {
      return { status: "existing", email: clean };
    }
    throw err;
  }
}

function totalCount() {
  return stmts.count.get().n;
}

function exportAll() {
  return stmts.all.all();
}

module.exports = { addEmail, totalCount, exportAll, _db: db, DB_PATH };
