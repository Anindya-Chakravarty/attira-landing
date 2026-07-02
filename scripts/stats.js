/* ===================================================================
   Attira — waitlist traction at a glance.
   Run:  node scripts/stats.js
   Prints the public total (what visitors see), how many of those are
   genuine signups, and how many are seed rows (social-proof fillers).
   =================================================================== */

const path = require("path");
const Database = require("better-sqlite3");

const DB_PATH =
  process.env.DB_PATH ||
  path.join(process.env.DATA_DIR || path.join(__dirname, "..", "data"), "waitlist.db");

const db = new Database(DB_PATH, { readonly: true });

const total = db.prepare("SELECT COUNT(*) AS n FROM waitlist").get().n;
const seeds = db.prepare("SELECT COUNT(*) AS n FROM waitlist WHERE source = 'seed'").get().n;
const real = total - seeds;

console.log(`\nWaitlist (${DB_PATH})`);
console.log(`  Public total (shown on site):  ${total}`);
console.log(`  Real signups:                  ${real}`);
console.log(`  Seed rows (social proof):      ${seeds}`);
console.log(`  Next real signup will be:      #${total + 1}\n`);
