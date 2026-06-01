/* ===================================================================
   Attira — export every waitlist email to a CSV file.
   Run:  npm run export        (or)  node export-emails.js
   Writes data/waitlist.csv, which opens directly in Excel / Sheets.
   =================================================================== */

const fs = require("fs");
const path = require("path");
const waitlist = require("./db");

const rows = waitlist.exportAll();

function csvEscape(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const header = "id,email,source,user_agent,created_at\n";
const body = rows
  .map((r) => [r.id, r.email, r.source, r.user_agent, r.created_at].map(csvEscape).join(","))
  .join("\n");

const outPath = path.join(__dirname, "data", "waitlist.csv");
fs.writeFileSync(outPath, header + body + "\n", "utf8");

console.log(`Exported ${rows.length} email${rows.length === 1 ? "" : "s"} → ${outPath}`);
