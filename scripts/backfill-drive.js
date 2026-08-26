#!/usr/bin/env node
/* ===================================================================
   Push existing applications into Google Drive.

     node scripts/backfill-drive.js              # sync whatever is pending
     node scripts/backfill-drive.js --all        # re-queue every row first
     node scripts/backfill-drive.js --ref=ATR-APP-XXXXX
     node scripts/backfill-drive.js --index-only # just rewrite the index

   Safe to re-run: the worker reuses the folder, doc and resume it
   already created for a row rather than making a second copy.

   Needs DRIVE_OAUTH in the environment (see scripts/drive-auth.js) and,
   for rows with uploaded files, the same DRIVE_UPLOAD_BUCKET the server
   staged them to.
   =================================================================== */

const careers = require("../careers-db");
const drive = require("../careers-drive");

function has(flag) {
  return process.argv.includes(`--${flag}`);
}
function arg(name) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : "";
}

async function main() {
  if (!drive.isConfigured()) {
    console.error("DRIVE_OAUTH is not set — run scripts/drive-auth.js first.");
    process.exit(1);
  }
  console.log(`Database: ${careers.DB_PATH}`);

  if (has("index-only")) {
    const index = await drive.rebuildIndex();
    console.log(`Index rewritten with ${index.rows} row(s).`);
    return;
  }

  const ref = arg("ref");
  if (ref) {
    const row = careers.getByRef(ref);
    if (!row) {
      console.error(`No application with ref ${ref}.`);
      process.exit(1);
    }
    careers.requeueForDrive(row.id);
    console.log(`Re-queued ${ref}.`);
  } else if (has("all")) {
    const rows = careers.allForDrive();
    for (const r of rows) careers.requeueForDrive(r.id);
    console.log(`Re-queued all ${rows.length} row(s).`);
  }

  /* Drain in batches rather than one pass: syncPending() caps how much it
     takes at once so a scheduled run can't overrun its request. */
  let total = { synced: 0, linkOnly: 0, failed: 0 };
  for (;;) {
    const summary = await drive.syncPending({ limit: 20 });
    if (!summary.attempted) break;
    total.synced += summary.synced;
    total.linkOnly += summary.linkOnly;
    total.failed += summary.failed;
    for (const r of summary.results) {
      const detail = r.error || r.reason || "";
      console.log(`  ${r.ref.padEnd(14)} ${r.status}${detail ? " — " + detail : ""}`);
    }
    if (summary.failed === summary.attempted) break; // nothing is progressing
  }

  console.log(
    `\nDone. ${total.synced} synced, ${total.linkOnly} link-only (no fetchable resume), ` +
    `${total.failed} failed.`
  );
  const root = await drive.ensureRootFolder();
  console.log(`Folder: https://drive.google.com/drive/folders/${root}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Backfill failed:", err.message);
    process.exit(1);
  });
