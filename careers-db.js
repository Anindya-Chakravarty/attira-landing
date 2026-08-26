/* ===================================================================
   Attira — job applications database (SQLite via better-sqlite3)

   Deliberately a SEPARATE database file from waitlist.db:
     • applicant PII (name, phone, compensation) should not sit in the
       same replica as the marketing waitlist,
     • it gets its own Litestream retention/snapshot cadence,
     • and a schema change here can never risk the waitlist table.

   SCHEMA DESIGN RULE — the table holds real columns for exactly two
   things: what EVERY role asks, and what you'll want to filter or sort
   on. Everything role-specific goes into the `answers` JSON blob. That is
   why adding a fourth role is a careers-roles.js edit with no migration.

   Corollary: NOT NULL is reserved for invariants that will be true for
   every role forever (ref/role/full_name/email/created_at). `phone`,
   `location` and `resume_url` are required by the current specs but stay
   nullable here, so role four can drop one without another table rebuild.
   The previous schema got this wrong — it put NOT NULL on designer-only
   columns like portfolio_url, and SQLite cannot drop NOT NULL via ALTER,
   which is what forced the rebuild below.

   The DB file lives at data/careers.db (created automatically).
   =================================================================== */

const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const DB_PATH = process.env.CAREERS_DB_PATH || path.join(DATA_DIR, "careers.db");

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

const TABLE_SQL = `(
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  ref           TEXT    UNIQUE NOT NULL,
  role          TEXT    NOT NULL,
  full_name     TEXT    NOT NULL,
  email         TEXT    NOT NULL COLLATE NOCASE,
  phone         TEXT,
  location      TEXT,
  resume_url    TEXT,
  current_comp  INTEGER,
  expected_comp INTEGER,
  comp_currency TEXT,
  anything_else TEXT,
  answers       TEXT    NOT NULL DEFAULT '{}',
  user_agent    TEXT,
  utm_source    TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
)`;

// 1. Fresh databases get the current schema straight away.
db.exec(`CREATE TABLE IF NOT EXISTS applications ${TABLE_SQL};`);

/* 2. Rebuild a database created by the single-role version.
      Detected structurally (same "read the columns first" idiom as
      db.js:43-61) rather than with a version table: once `answers` exists
      and `portfolio_url` doesn't, the guard is false forever, so this is
      idempotent by construction. */
const cols = db.prepare("PRAGMA table_info(applications)").all().map((c) => c.name);
const isLegacy = cols.includes("portfolio_url") && !cols.includes("answers");

function safeJsonArray(v) {
  try {
    const parsed = JSON.parse(v);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

if (isLegacy) {
  const legacy = db.prepare("SELECT * FROM applications ORDER BY id ASC").all();
  console.warn(
    `[careers-db] migrating ${legacy.length} row(s) from the single-role schema to the multi-role schema`
  );

  // One transaction: a crash mid-rebuild rolls back cleanly under WAL.
  const rebuild = db.transaction(() => {
    db.exec("DROP TABLE IF EXISTS applications_v2"); // insurance against a half-done prior run
    db.exec(`CREATE TABLE applications_v2 ${TABLE_SQL};`);

    const ins = db.prepare(`
      INSERT INTO applications_v2
        (id, ref, role, full_name, email, phone, location, resume_url,
         current_comp, expected_comp, comp_currency, anything_else,
         answers, user_agent, utm_source, created_at)
      VALUES
        (@id, @ref, @role, @full_name, @email, @phone, @location, @resume_url,
         @current_comp, @expected_comp, @comp_currency, @anything_else,
         @answers, @user_agent, @utm_source, @created_at)`);

    for (const r of legacy) {
      ins.run({
        id: r.id, // preserved so already-issued ATR-APP- refs stay on the same row
        ref: r.ref,
        role: r.role || "uiux-designer",
        full_name: r.full_name,
        email: r.email,
        phone: r.phone,
        location: r.location,
        resume_url: r.resume_url,
        current_comp: r.current_comp,
        expected_comp: r.expected_comp,
        comp_currency: r.comp_currency,
        anything_else: r.anything_else,
        user_agent: r.user_agent,
        utm_source: r.utm_source,
        created_at: r.created_at,
        // Designer-only columns fold into the blob under the SAME camelCase
        // names the spec uses, so exports stay uniform across old and new
        // rows. artefact_links/tools were ALREADY JSON strings, so they must
        // be parsed — embedding them would double-encode.
        answers: JSON.stringify({
          portfolioUrl: r.portfolio_url || "",
          yearsExperience: r.years_experience || "",
          shipped: r.shipped || "",
          artefactLinks: safeJsonArray(r.artefact_links),
          tools: safeJsonArray(r.tools),
          toolsOther: r.tools_other || "",
          firstTwoWeeks: r.first_two_weeks || "",
        }),
      });
    }

    db.exec("DROP TABLE applications");
    db.exec("ALTER TABLE applications_v2 RENAME TO applications");
  });

  rebuild();
  console.warn("[careers-db] migration complete");
}

/* 3. Additive migrations for anything added after this point. Keep
      appending; never reorder or remove entries. */
const currentCols = new Set(
  db.prepare("PRAGMA table_info(applications)").all().map((c) => c.name)
);
const ADD_COLUMNS = [
  // GCS object keys for uploaded files (currently the resume), as a JSON
  // array. resume_url stays valid for link-based applications — an
  // applicant may use either, and careers-drive.js handles both.
  ["file_keys", "TEXT"],

  /* Google Drive mirror state (careers-drive.js). Every row starts
     'pending', which is also what the existing rows become the moment
     this migration runs — so the backfill is just "run the worker".
     Statuses: pending → synced, or error (retried), or link-only
     (synced, but the resume was an unfetchable link rather than a file). */
  ["drive_status", "TEXT NOT NULL DEFAULT 'pending'"],
  ["drive_folder_id", "TEXT"],
  ["drive_doc_id", "TEXT"],
  ["drive_resume_id", "TEXT"],
  ["drive_attempts", "INTEGER NOT NULL DEFAULT 0"],
  ["drive_error", "TEXT"],
  ["drive_synced_at", "TEXT"],
];
for (const [col, type] of ADD_COLUMNS) {
  if (!currentCols.has(col)) db.exec(`ALTER TABLE applications ADD COLUMN ${col} ${type}`);
}

/* 4. Indexes LAST — DROP TABLE above takes its indexes with it, so these
      have to be (re)created after any rebuild, not alongside the CREATE. */
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_applications_created_at   ON applications(created_at);
  CREATE INDEX IF NOT EXISTS idx_applications_email        ON applications(email);
  CREATE INDEX IF NOT EXISTS idx_applications_role         ON applications(role);
  CREATE INDEX IF NOT EXISTS idx_applications_drive_status ON applications(drive_status);
`);

const COLUMNS = [
  "ref",
  "role",
  "full_name",
  "email",
  "phone",
  "location",
  "resume_url",
  "current_comp",
  "expected_comp",
  "comp_currency",
  "anything_else",
  "answers",
  "user_agent",
  "utm_source",
  // JSON array of GCS object keys staged by /api/careers/upload.
  "file_keys",
];

const SELECT_COLS = `id, ${COLUMNS.join(", ")}, created_at`;

/* The Drive mirror needs the sync bookkeeping as well as the answers, so
   it reads through its own column list rather than SELECT_COLS. */
const DRIVE_COLS = `${SELECT_COLS}, drive_status, drive_folder_id, drive_doc_id,
  drive_resume_id, drive_attempts, drive_error, drive_synced_at`;

/* Give up after this many failed attempts so one poisoned row can't spin
   the worker forever. The row stays queryable as status='error'. */
const MAX_DRIVE_ATTEMPTS = 8;

const stmts = {
  insert: db.prepare(
    `INSERT INTO applications (${COLUMNS.join(", ")})
     VALUES (${COLUMNS.map((c) => `@${c}`).join(", ")})`
  ),
  findByRef: db.prepare("SELECT * FROM applications WHERE ref = ?"),
  count: db.prepare("SELECT COUNT(*) AS n FROM applications"),
  countByRole: db.prepare("SELECT COUNT(*) AS n FROM applications WHERE role = ?"),
  all: db.prepare(`SELECT ${SELECT_COLS} FROM applications ORDER BY id ASC`),
  allByRole: db.prepare(`SELECT ${SELECT_COLS} FROM applications WHERE role = ? ORDER BY id ASC`),
  recent: db.prepare(`SELECT ${SELECT_COLS} FROM applications ORDER BY id DESC LIMIT ? OFFSET ?`),
  recentByRole: db.prepare(
    `SELECT ${SELECT_COLS} FROM applications WHERE role = ? ORDER BY id DESC LIMIT ? OFFSET ?`
  ),

  /* ── Drive mirror ── */
  drivePending: db.prepare(
    `SELECT ${DRIVE_COLS} FROM applications
      WHERE drive_status IN ('pending', 'error') AND drive_attempts < ?
      ORDER BY id ASC LIMIT ?`
  ),
  driveAll: db.prepare(`SELECT ${DRIVE_COLS} FROM applications ORDER BY id ASC`),
  driveById: db.prepare(`SELECT ${DRIVE_COLS} FROM applications WHERE id = ?`),
  driveAttempt: db.prepare(
    "UPDATE applications SET drive_attempts = drive_attempts + 1 WHERE id = ?"
  ),
  driveSynced: db.prepare(
    `UPDATE applications
        SET drive_status = @status, drive_folder_id = @folderId, drive_doc_id = @docId,
            drive_resume_id = @resumeId, drive_error = NULL,
            drive_synced_at = datetime('now')
      WHERE id = @id`
  ),
  driveFailed: db.prepare(
    "UPDATE applications SET drive_status = 'error', drive_error = @error WHERE id = @id"
  ),
  /* Partial progress is saved as it happens: a run that creates the folder
     then dies on the resume upload must not create a second folder next
     time round. */
  driveProgress: db.prepare(
    `UPDATE applications
        SET drive_folder_id = COALESCE(@folderId, drive_folder_id),
            drive_doc_id    = COALESCE(@docId, drive_doc_id),
            drive_resume_id = COALESCE(@resumeId, drive_resume_id)
      WHERE id = @id`
  ),
  driveRequeue: db.prepare(
    "UPDATE applications SET drive_status = 'pending', drive_attempts = 0, drive_error = NULL WHERE id = ?"
  ),
  setFileKeys: db.prepare("UPDATE applications SET file_keys = @file_keys WHERE id = @id"),
};

/* ── Application reference codes ────────────────────────────────────
   Same Crockford-ish alphabet as db.js (no 0/O/1/I) so a code can be
   read aloud on a call without ambiguity. Format: ATR-APP-XXXXX. */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function generateRef() {
  let s = "";
  for (let i = 0; i < 5; i++) {
    s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return `ATR-APP-${s}`;
}

/* Insert one application. Retries on the (very rare) ref collision, the
   same way addEmail() does for share codes. Returns { ref, id }. */
function addApplication(fields) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const ref = generateRef();
    try {
      const row = { ref };
      for (const col of COLUMNS) {
        if (col === "ref") continue;
        row[col] = fields[col] === undefined ? null : fields[col];
      }
      // answers is NOT NULL — never let a missing key become null here.
      if (row.answers === null) row.answers = "{}";
      const info = stmts.insert.run(row);
      return { ref, id: info.lastInsertRowid };
    } catch (err) {
      if (err && err.code === "SQLITE_CONSTRAINT_UNIQUE") continue;
      throw err;
    }
  }
  throw new Error("Could not generate a unique application reference.");
}

function getByRef(ref) {
  return stmts.findByRef.get(String(ref || "")) || null;
}

function totalCount(role) {
  return role ? stmts.countByRole.get(role).n : stmts.count.get().n;
}

function exportAll(role) {
  return role ? stmts.allByRole.all(role) : stmts.all.all();
}

function listApplications({ role, limit = 50, offset = 0 } = {}) {
  const lim = Math.min(200, Math.max(1, limit | 0));
  const off = Math.max(0, offset | 0);
  const rows = role ? stmts.recentByRole.all(role, lim, off) : stmts.recent.all(lim, off);
  return { total: totalCount(role), role: role || null, limit: lim, offset: off, rows };
}

/* ── Drive mirror bookkeeping ────────────────────────────────────────
   Kept here rather than in careers-drive.js so every statement against
   this table lives in one file. */

function pendingForDrive(limit = 20) {
  return stmts.drivePending.all(MAX_DRIVE_ATTEMPTS, Math.max(1, limit | 0));
}

function allForDrive() {
  return stmts.driveAll.all();
}

function getForDrive(id) {
  return stmts.driveById.get(id) || null;
}

function noteDriveAttempt(id) {
  stmts.driveAttempt.run(id);
}

/* status is 'synced' for a complete mirror, or 'link-only' when the
   resume existed solely as a link we could not fetch — a real outcome
   worth seeing in the index, not an error to retry forever. */
function markDriveSynced(id, { status = "synced", folderId = null, docId = null, resumeId = null } = {}) {
  stmts.driveSynced.run({ id, status, folderId, docId, resumeId });
}

function markDriveFailed(id, error) {
  stmts.driveFailed.run({ id, error: String(error || "").slice(0, 500) });
}

function noteDriveProgress(id, { folderId = null, docId = null, resumeId = null } = {}) {
  stmts.driveProgress.run({ id, folderId, docId, resumeId });
}

/* Re-queue a row for another pass — used by scripts/backfill-drive.js and
   after a fix, so you don't have to hand-edit the database. */
function requeueForDrive(id) {
  stmts.driveRequeue.run(id);
}

function setFileKeys(id, keys) {
  stmts.setFileKeys.run({ id, file_keys: keys && keys.length ? JSON.stringify(keys) : null });
}

module.exports = {
  addApplication,
  getByRef,
  listApplications,
  totalCount,
  exportAll,
  pendingForDrive,
  allForDrive,
  getForDrive,
  noteDriveAttempt,
  noteDriveProgress,
  markDriveSynced,
  markDriveFailed,
  requeueForDrive,
  setFileKeys,
  COLUMNS,
  MAX_DRIVE_ATTEMPTS,
  _db: db,
  DB_PATH,
};
