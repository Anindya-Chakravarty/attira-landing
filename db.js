/* ===================================================================
   Attira — waitlist database (SQLite via better-sqlite3)
   One table that retains every email submitted through the landing
   page's "Get early access" form so you can reach out to people later.
   It also powers the referral loop: each signup gets a unique short
   share code (ATR-XXXXX); joining through someone's link bumps their
   referral_count and moves them up the queue.
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
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    email        TEXT    UNIQUE NOT NULL COLLATE NOCASE,
    source       TEXT    DEFAULT 'website',
    utm_source   TEXT,
    utm_medium   TEXT,
    utm_campaign TEXT,
    user_agent   TEXT,
    created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_waitlist_created_at ON waitlist(created_at);
`);

// Migrate older databases that predate newer columns: add any that are
// missing. (SQLite has no "ADD COLUMN IF NOT EXISTS", so check first.)
// referral_count gets a DEFAULT 0 so existing rows backfill cleanly.
const existingCols = new Set(
  db.prepare("PRAGMA table_info(waitlist)").all().map((c) => c.name)
);
const ADD_COLUMNS = [
  ["utm_source", "TEXT"],
  ["utm_medium", "TEXT"],
  ["utm_campaign", "TEXT"],
  ["share_code", "TEXT"],
  ["referred_by_code", "TEXT"],
  ["referral_count", "INTEGER NOT NULL DEFAULT 0"],
  // The channel a referee arrived through (wa/ig/tt/x/dm/…) so we can see
  // which share surface actually drives signups. NULL for organic joins.
  ["referred_via_channel", "TEXT"],
];
for (const [col, type] of ADD_COLUMNS) {
  if (!existingCols.has(col)) {
    db.exec(`ALTER TABLE waitlist ADD COLUMN ${col} ${type}`);
  }
}

// share_code can't be added as a UNIQUE column via ALTER, so enforce
// uniqueness with a partial unique index (skips NULLs from legacy rows).
db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_waitlist_share_code
    ON waitlist(share_code) WHERE share_code IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_waitlist_rank
    ON waitlist(referral_count DESC, created_at ASC);
  CREATE INDEX IF NOT EXISTS idx_waitlist_referred_by
    ON waitlist(referred_by_code);
`);

const stmts = {
  insert: db.prepare(
    `INSERT INTO waitlist
       (email, source, utm_source, utm_medium, utm_campaign, user_agent, share_code, referred_by_code, referred_via_channel)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ),
  findByEmail: db.prepare(
    "SELECT id, email, share_code, referral_count, referred_by_code, created_at FROM waitlist WHERE email = ?"
  ),
  findByShareCode: db.prepare(
    "SELECT id, email, share_code, referral_count, referred_by_code, created_at FROM waitlist WHERE share_code = ?"
  ),
  bumpReferrer: db.prepare(
    "UPDATE waitlist SET referral_count = referral_count + 1 WHERE share_code = ?"
  ),
  count: db.prepare("SELECT COUNT(*) AS n FROM waitlist"),
  // position helpers: how many entries strictly outrank a given one.
  betterByReferrals: db.prepare(
    "SELECT COUNT(*) AS n FROM waitlist WHERE referral_count > ?"
  ),
  tieBreakers: db.prepare(
    "SELECT COUNT(*) AS n FROM waitlist WHERE referral_count = ? AND created_at < ?"
  ),
  leaderboard: db.prepare(
    `SELECT email, share_code, referral_count
       FROM waitlist
      WHERE share_code IS NOT NULL
      ORDER BY referral_count DESC, created_at ASC
      LIMIT 10`
  ),
  // Signup-order queue (everyone, oldest first). id breaks same-second ties.
  queuePage: db.prepare(
    `SELECT email, created_at
       FROM waitlist
      ORDER BY created_at ASC, id ASC
      LIMIT ? OFFSET ?`
  ),
  all: db.prepare(
    `SELECT id, email, source, utm_source, utm_medium, utm_campaign,
            user_agent, share_code, referred_by_code, referred_via_channel,
            referral_count, created_at
       FROM waitlist ORDER BY id ASC`
  ),
};

/* ── Share-code generation ──────────────────────────────────────────
   Crockford-ish alphabet: no 0/O/1/I so codes are easy to read aloud
   and retype. Format: ATR-XXXXX (5 chars). */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function generateShareCode() {
  let s = "";
  for (let i = 0; i < 5; i++) {
    s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return `ATR-${s}`;
}

/* ── Email masking for the public leaderboard ───────────────────────
   j****n@gmail.com — keep first (and last, if long enough) char of the
   local part, mask the rest. Raw emails never leave the server. */
function maskEmail(email) {
  const [user, domain] = String(email || "").split("@");
  if (!domain) return "***";
  const head = user.slice(0, 1);
  const tail = user.length > 2 ? user.slice(-1) : "";
  const stars = "*".repeat(Math.max(1, user.length - (tail ? 2 : 1)));
  return `${head}${stars}${tail}@${domain}`;
}

/* ── Queue position ─────────────────────────────────────────────────
   Strictly better = more referrals, OR same referrals but earlier
   signup. Position is that count + 1. Computed on read (no stored rank). */
function computePosition(referralCount, createdAt) {
  const better = stmts.betterByReferrals.get(referralCount).n;
  const ties = stmts.tieBreakers.get(referralCount, createdAt).n;
  return better + ties + 1;
}

/* ── Two-sided referral rewards ──────────────────────────────────────
   Like position, rewards are DERIVED on read from referral_count — there
   is no stored reward state. The ladder below is the single source of
   truth; a member's tier is the highest rung whose threshold they've met.
   Referees (people who joined through a link) get a welcome perk on top.
   Everything here is a promise redeemed at app launch — no entitlement
   plumbing is needed now, only an honest record (see exportAll). */
const TIERS = [
  { referrals: 3, label: "Priority access", premiumMonths: 0, priority: true, founder: false },
  { referrals: 5, label: "1 month Premium", premiumMonths: 1, priority: true, founder: false },
  { referrals: 10, label: "3 months Premium", premiumMonths: 3, priority: true, founder: false },
  { referrals: 25, label: "Founder · 6 months", premiumMonths: 6, priority: true, founder: true },
];
// Welcome credit for joining through someone's link (the second side of the
// loop — turns "help me" into "we both win").
const REFEREE_PREMIUM_WEEKS = 2;

function rewardFor(referralCount, referredByCode) {
  const count = Math.max(0, referralCount || 0);
  let current = null;
  let next = null;
  for (const t of TIERS) {
    if (count >= t.referrals) current = t;
    else { next = t; break; }
  }
  const isReferee = !!referredByCode;
  return {
    referralCount: count,
    tier: current ? current.label : null,
    priority: current ? current.priority : false,
    founder: current ? current.founder : false,
    premiumMonths: current ? current.premiumMonths : 0,
    isReferee,
    refereePremiumWeeks: isReferee ? REFEREE_PREMIUM_WEEKS : 0,
    nextTier: next ? next.label : null,
    nextTierAt: next ? next.referrals : null,
    toNext: next ? Math.max(0, next.referrals - count) : 0,
    // Compact ladder so the client can draw the full sequence without
    // duplicating the table.
    ladder: TIERS.map((t) => ({ referrals: t.referrals, label: t.label, reached: count >= t.referrals })),
  };
}

/* ── Public leaderboard (top 10, masked emails) ─────────────────── */
function buildLeaderboard() {
  return stmts.leaderboard.all().map((r, i) => ({
    rank: i + 1,
    maskedEmail: maskEmail(r.email),
    shareCode: r.share_code,
    referralCount: r.referral_count,
    founder: (r.referral_count || 0) >= 25,
  }));
}

function getByShareCode(code) {
  return stmts.findByShareCode.get(String(code || "")) || null;
}

// Store an email. Idempotent: re-submitting the same address is a no-op
// and reports back as "existing" (with that row's current referral state)
// rather than throwing.
//
// `ref` is an optional share code of the person who referred this signup.
// Only honoured for brand-new signups, and only if it points at a real
// entry; the insert + referrer bump run in one transaction so a crash
// can't leave a referral half-counted.
function addEmail({ email, source, userAgent, utm, ref, channel }) {
  const clean = String(email || "").trim().toLowerCase();
  const u = utm || {};

  const existing = stmts.findByEmail.get(clean);
  if (existing) {
    return {
      status: "existing",
      email: clean,
      shareCode: existing.share_code,
      referralCount: existing.referral_count,
      createdAt: existing.created_at,
    };
  }

  // Only honour a ref that points at a real, existing share code.
  let validRef = null;
  const refCode = ref ? String(ref).trim().toUpperCase() : "";
  if (refCode && getByShareCode(refCode)) {
    validRef = refCode;
  }

  // Insert + bump the referrer atomically. Retry on the rare share-code
  // collision; a UNIQUE hit on email means a race — treat as existing.
  // The channel only describes how a *referred* visitor arrived, so it's
  // only recorded alongside a valid referrer.
  const refChannel = validRef && channel ? String(channel).slice(0, 8) : null;

  const insertWithCode = db.transaction((shareCode) => {
    stmts.insert.run(
      clean,
      source || "website",
      u.utm_source || null,
      u.utm_medium || null,
      u.utm_campaign || null,
      (userAgent || "").slice(0, 255),
      shareCode,
      validRef,
      refChannel
    );
    if (validRef) stmts.bumpReferrer.run(validRef);
  });

  for (let attempt = 0; attempt < 6; attempt++) {
    const shareCode = generateShareCode();
    try {
      insertWithCode(shareCode);
      return { status: "created", email: clean, shareCode, referralCount: 0 };
    } catch (err) {
      if (err && err.code === "SQLITE_CONSTRAINT_UNIQUE") {
        // Was it the email (race) or the share_code (retry)?
        const again = stmts.findByEmail.get(clean);
        if (again) {
          return {
            status: "existing",
            email: clean,
            shareCode: again.share_code,
            referralCount: again.referral_count,
            createdAt: again.created_at,
          };
        }
        continue; // share_code collision — try a new code
      }
      throw err;
    }
  }
  throw new Error("Could not generate a unique share code. Please try again.");
}

function totalCount() {
  return stmts.count.get().n;
}

function exportAll() {
  return stmts.all.all();
}

// Genuine signups only — everything addEmail() created. Seed rows (inserted
// by scripts/seed-waitlist.js with source='seed' purely for social proof) are
// excluded so real outreach lists and traction counts never include them.
function exportReal() {
  return stmts.all.all().filter((r) => r.source !== "seed");
}

/* ── Public queue in pure signup order ──────────────────────────────
   Everyone, oldest first (first to join = #1). Emails are masked — raw
   addresses never leave the server. Paginated via limit/offset; position
   is the global rank, so it stays correct across pages. This is separate
   from the referral-weighted computePosition()/buildLeaderboard(). */
function queue({ limit = 100, offset = 0 } = {}) {
  const lim = Math.min(200, Math.max(1, limit | 0));
  const off = Math.max(0, offset | 0);
  const rows = stmts.queuePage.all(lim, off).map((r, i) => ({
    position: off + i + 1,
    maskedEmail: maskEmail(r.email),
    joinedAt: r.created_at,
  }));
  return { total: totalCount(), limit: lim, offset: off, rows };
}

module.exports = {
  addEmail,
  totalCount,
  exportAll,
  exportReal,
  queue,
  getByShareCode,
  computePosition,
  rewardFor,
  buildLeaderboard,
  maskEmail,
  _db: db,
  DB_PATH,
};
