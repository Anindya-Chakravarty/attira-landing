/* ===================================================================
   Attira — seed the waitlist with social-proof entries.

   Pre-populates the waitlist with 75 plausible-but-synthetic signups so
   the first genuine visitor lands at position #76, the public queue looks
   alive, and the top-10 referral leaderboard isn't empty on day one.

   These rows are tagged  source='seed'  so they:
     • show in the PUBLIC total / queue / leaderboard (the social proof), but
     • are EXCLUDED from email exports and the real-signup count (db.exportReal),
       so they are never emailed and never mistaken for real traction.

   The seeder writes straight to SQLite, so it fires ZERO PostHog events.

   Run:
     node scripts/seed-waitlist.js                  # seed (refuses if seeds exist)
     node scripts/seed-waitlist.js --reset-test-rows # also delete existing non-seed
                                                      # rows first, so next real = #76
     node scripts/seed-waitlist.js --force          # re-seed even if seeds exist
   =================================================================== */

const fs = require("fs");
const path = require("path");

// Require the app's db module so the schema + all migrations are guaranteed
// applied, then reach the underlying better-sqlite3 handle for the custom
// INSERT (addEmail can't set created_at / referral_count / source='seed').
const waitlist = require("./../db");
const db = waitlist._db;

const FORCE = process.argv.includes("--force");
const RESET_TEST_ROWS = process.argv.includes("--reset-test-rows");
const SEED_COUNT = 75;

/* ── 0. Refuse to double-seed unless --force ───────────────────────── */
const existingSeeds = db.prepare("SELECT COUNT(*) AS n FROM waitlist WHERE source = 'seed'").get().n;
if (existingSeeds > 0 && !FORCE) {
  console.error(
    `\n✗ ${existingSeeds} seed row(s) already exist. Re-running would create duplicates.\n` +
      `  Pass --force to seed anyway, or remove them first:\n` +
      `    sqlite3 data/waitlist.db "DELETE FROM waitlist WHERE source='seed';"\n`
  );
  process.exit(1);
}

/* ── 1. Back up the DB file first (reversible) ─────────────────────── */
// Flush WAL into the main db file so a plain file copy is a complete snapshot.
db.pragma("wal_checkpoint(TRUNCATE)");
const DB_PATH = waitlist.DB_PATH;
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupPath = `${DB_PATH}.bak-${stamp}`;
fs.copyFileSync(DB_PATH, backupPath);
console.log(`✓ Backed up DB → ${path.basename(backupPath)}`);

/* ── 2. Optionally clear existing non-seed (founder/test) rows ─────── */
// With these gone, exactly the 75 seeds precede any new signup → next = #76.
if (RESET_TEST_ROWS) {
  const realRows = db.prepare("SELECT email FROM waitlist WHERE source != 'seed'").all();
  if (realRows.length) {
    console.log(`\n⚠ --reset-test-rows: deleting ${realRows.length} existing non-seed row(s):`);
    realRows.forEach((r) => console.log(`    - ${r.email}`));
    db.prepare("DELETE FROM waitlist WHERE source != 'seed'").run();
  } else {
    console.log("\n--reset-test-rows: no non-seed rows to delete.");
  }
}

/* ── 3. Identity pools (Indian names → plausible consumer emails) ──── */
const FIRST = [
  "aarav", "vivaan", "aditya", "vihaan", "arjun", "sai", "reyansh", "krishna",
  "ishaan", "rohan", "kabir", "aryan", "dhruv", "kiaan", "aarush", "rahul",
  "karan", "vikram", "siddharth", "ayaan", "advait", "yash", "harsh", "nikhil",
  "ritvik", "ananya", "diya", "aadhya", "saanvi", "anika", "navya", "aarohi",
  "myra", "sara", "riya", "neha", "pooja", "sneha", "priya", "kavya", "isha",
  "tara", "meera", "nisha", "simran", "tanvi", "ira", "mahi", "kiara", "zoya",
];
const LAST = [
  "sharma", "verma", "gupta", "patel", "reddy", "nair", "iyer", "menon", "rao",
  "mehta", "joshi", "desai", "kapoor", "chopra", "malhotra", "bose", "banerjee",
  "das", "singh", "kaur", "bhat", "shetty", "pillai", "naidu", "agarwal", "jain",
  "shah", "kulkarni", "pandey", "mishra", "chauhan", "yadav", "saxena", "bhatia",
  "ghosh", "sengupta", "chatterjee", "mukherjee", "deshpande", "nanda",
];
// gmail.com dominant, like a real Indian consumer list.
const DOMAINS = [
  "gmail.com", "gmail.com", "gmail.com", "gmail.com", "gmail.com", "gmail.com",
  "outlook.com", "yahoo.com", "yahoo.in", "hotmail.com", "icloud.com",
];

const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randInt = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));

function makeEmail() {
  const f = rand(FIRST);
  const l = rand(LAST);
  const d = rand(DOMAINS);
  const n = randInt(1, 99);
  const local = rand([
    `${f}.${l}`,
    `${f}${l}`,
    `${f}.${l}${n}`,
    `${f}${l[0]}${n}`,
    `${f[0]}${l}`,
    `${f}_${l}`,
    `${f}${n}`,
  ]);
  return `${local}@${d}`;
}

// Build SEED_COUNT unique emails not already in the DB.
const taken = new Set(
  db.prepare("SELECT lower(email) AS e FROM waitlist").all().map((r) => r.e)
);
const emails = [];
while (emails.length < SEED_COUNT) {
  const e = makeEmail();
  if (!taken.has(e)) {
    taken.add(e);
    emails.push(e);
  }
}

/* ── 4. Share codes (ATR-XXXXX), unique vs DB + each other ─────────── */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // matches db.js:122
function makeCode() {
  let s = "";
  for (let i = 0; i < 5; i++) s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return `ATR-${s}`;
}
const usedCodes = new Set(
  db.prepare("SELECT share_code FROM waitlist WHERE share_code IS NOT NULL").all().map((r) => r.share_code)
);
function uniqueCode() {
  let c = makeCode();
  while (usedCodes.has(c)) c = makeCode();
  usedCodes.add(c);
  return c;
}

/* ── 5. Backdated timestamps, ramping toward recent ────────────────── */
// Anchor strictly before the earliest surviving real row (so seeds always
// occupy positions 1..75), else before now.
function fmt(date) {
  // 'YYYY-MM-DD HH:MM:SS' in UTC, matching SQLite datetime('now').
  return date.toISOString().slice(0, 19).replace("T", " ");
}
const earliestReal = db
  .prepare("SELECT MIN(created_at) AS m FROM waitlist WHERE source != 'seed'")
  .get().m;
const anchorMs = earliestReal ? new Date(earliestReal + "Z").getTime() : Date.now();
const DAY = 86400000;
const WINDOW_DAYS = 45;

const timestamps = [];
for (let i = 0; i < SEED_COUNT; i++) {
  // sqrt skew → more signups in recent days (organic-looking ramp).
  const daysAgo = WINDOW_DAYS * (1 - Math.sqrt(Math.random()));
  const ms = anchorMs - DAY - daysAgo * DAY + randInt(0, DAY - 1) - randInt(0, DAY);
  timestamps.push(ms);
}
// Oldest first: positions 1..75 in signup order.
timestamps.sort((a, b) => a - b);

/* ── 6. Top-heavy referral distribution on the earliest seeds ──────── */
// Early adopters referred the most; long tail at 0. Max < 25 → no accidental
// "Founder" badge (db.js:163), keeping the top aspirational rather than maxed.
const REFERRALS = [15, 11, 9, 7, 6, 5, 4, 4, 3, 3, 2, 2, 2, 1, 1];

/* ── 7. Insert everything in one transaction ───────────────────────── */
const insert = db.prepare(
  `INSERT INTO waitlist (email, source, share_code, referral_count, created_at)
   VALUES (@email, 'seed', @share_code, @referral_count, @created_at)`
);
const insertAll = db.transaction((rows) => rows.forEach((r) => insert.run(r)));

const rows = emails.map((email, i) => ({
  email,
  share_code: uniqueCode(),
  referral_count: REFERRALS[i] || 0,
  created_at: fmt(new Date(timestamps[i])),
}));
insertAll(rows);

/* ── 8. Report ─────────────────────────────────────────────────────── */
const total = waitlist.totalCount();
console.log(`\n✓ Seeded ${rows.length} rows. Public total is now ${total}.`);
console.log(`  Next genuine signup will be position #${total + 1}.`);

console.log("\nPublic queue (first 5, masked):");
waitlist.queue({ limit: 5 }).rows.forEach((r) =>
  console.log(`  #${r.position}  ${r.maskedEmail}  ${r.joinedAt}`)
);

console.log("\nLeaderboard (top 5):");
waitlist.buildLeaderboard().slice(0, 5).forEach((r) =>
  console.log(`  ${r.rank}. ${r.maskedEmail}  ${r.referralCount} referrals${r.founder ? "  ★ Founder" : ""}`)
);
console.log("");
