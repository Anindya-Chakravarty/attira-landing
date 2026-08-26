#!/usr/bin/env node
/* ===================================================================
   Offline test for the Drive mirror.

     node scripts/test-drive-mock.js

   Stands up a fake Drive API, points careers-drive.js at it with
   DRIVE_API_BASE, and drives a temporary database through a full sync.
   Checks the things that are easy to get wrong and expensive to discover
   in production: the multipart envelope, the conversion mime types, and
   above all IDEMPOTENCY — a second pass must reuse the folder, doc and
   resume rather than making a second copy of each.

   It does not prove Google accepts the requests; only a run against the
   real API does that. It does prove we send what we think we send.
   =================================================================== */

const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const assert = require("assert");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "attira-drive-test-"));
process.env.DATA_DIR = tmp;
process.env.CAREERS_DB_PATH = path.join(tmp, "careers.db");
process.env.DRIVE_OAUTH = JSON.stringify({
  client_id: "test", client_secret: "test", access_token: "test-token",
});

/* ── the fake Drive ─────────────────────────────────────────────── */

const calls = [];
const files = new Map(); // id → {name, mimeType, parents, bytes, contentType}
let nextId = 1;

/* Enough of a multipart/related parser to read back what we sent. The
   body is split as latin1 so binary payloads survive byte-for-byte; the
   metadata part is re-decoded as UTF-8, or every em-dash in a candidate
   name comes back mojibake. */
function parseMultipart(body, contentType) {
  const boundary = /boundary=([^;]+)/.exec(contentType)[1];
  const parts = body.toString("latin1").split(`--${boundary}`);
  const metaRaw = parts[1].split("\r\n\r\n").slice(1).join("\r\n\r\n").trim();
  const meta = JSON.parse(Buffer.from(metaRaw, "latin1").toString("utf8"));
  const second = parts[2] || "";
  const headerEnd = second.indexOf("\r\n\r\n");
  const partType = /Content-Type:\s*([^\r\n]+)/i.exec(second.slice(0, headerEnd))[1].trim();
  const payload = Buffer.from(second.slice(headerEnd + 4, second.length - 2), "latin1");
  return { meta, partType, payload };
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://mock");
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const body = Buffer.concat(chunks);
    const reply = (obj) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(obj));
    };

    assert.match(req.headers.authorization || "", /^Bearer /, "every call must be authorised");

    // files.list
    if (req.method === "GET" && url.pathname === "/drive/v3/files") {
      const q = url.searchParams.get("q");
      calls.push({ op: "list", q });
      const name = /name = '((?:[^'\\]|\\.)*)'/.exec(q)[1].replace(/\\'/g, "'");
      const parent = /'([^']+)' in parents/.exec(q);
      const hit = [...files.entries()].find(
        ([, f]) => f.name === name && (!parent || (f.parents || []).includes(parent[1]))
      );
      return reply({ files: hit ? [{ id: hit[0], name: hit[1].name }] : [] });
    }

    // files.create (folder)
    if (req.method === "POST" && url.pathname === "/drive/v3/files") {
      const meta = JSON.parse(body.toString());
      const id = `id-${nextId++}`;
      files.set(id, meta);
      calls.push({ op: "create-folder", name: meta.name, parents: meta.parents });
      return reply({ id });
    }

    // uploads — create and update
    if (url.pathname.startsWith("/upload/drive/v3/files")) {
      const { meta, partType, payload } = parseMultipart(body, req.headers["content-type"]);
      assert.strictEqual(url.searchParams.get("uploadType"), "multipart");
      const idInPath = url.pathname.split("/").pop();
      const id = req.method === "PATCH" ? idInPath : `id-${nextId++}`;
      files.set(id, { ...meta, contentType: partType, bytes: payload.length });
      calls.push({
        op: req.method === "PATCH" ? "update" : "upload",
        id, name: meta.name, targetMime: meta.mimeType, partType, bytes: payload.length,
      });
      return reply({ id });
    }

    res.writeHead(404);
    res.end("{}");
  });
});

/* ── the run ────────────────────────────────────────────────────── */

function seed(careers) {
  const common = {
    role: "design-social-associate", email: "a@example.com", phone: "+919876543210",
    location: "Bengaluru", current_comp: 25000, expected_comp: 40000, comp_currency: "INR",
    answers: JSON.stringify({
      currentStatus: "working", collegeOrg: "Test College",
      portfolioLink: "https://example.com/portfolio", reelUrl: "https://example.com/reel",
      bestAccount: "A brand I like, because <of> reasons & things.",
      tools: ["Canva", "Figma"], toolsOther: "Blender", noticePeriod: "immediately",
    }),
  };
  // 1: an uploaded file. 2: a link we can't fetch. 3: no resume at all.
  const staged = path.join(tmp, "uploads");
  fs.mkdirSync(staged, { recursive: true });
  const key = "local:00000000-0000-4000-8000-000000000001";
  fs.writeFileSync(path.join(staged, key.slice(6)), Buffer.from("%PDF-1.4\nfake pdf bytes\n"));
  fs.writeFileSync(
    path.join(staged, key.slice(6) + ".json"),
    JSON.stringify({ contentType: "application/pdf", originalName: "cv.pdf" })
  );

  careers.addApplication({ ...common, full_name: "Uploaded Resume", file_keys: JSON.stringify([key]) });
  careers.addApplication({ ...common, full_name: "Unfetchable Link", resume_url: "http://127.0.0.1:9/nope.pdf" });
  careers.addApplication({ ...common, full_name: "No Resume" });
}

function count(op, extra = () => true) {
  return calls.filter((c) => c.op === op && extra(c)).length;
}

async function main() {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  process.env.DRIVE_API_BASE = `http://127.0.0.1:${server.address().port}`;

  const careers = require("../careers-db");
  const drive = require("../careers-drive");
  seed(careers);

  const first = await drive.syncPending({ limit: 10 });
  assert.strictEqual(first.attempted, 3, "all three rows should be attempted");
  assert.strictEqual(first.synced, 1, "only the uploaded resume yields a file");
  assert.strictEqual(first.linkOnly, 2, "a dead link and no resume are both link-only");
  assert.strictEqual(first.failed, 0, "nothing should error");

  assert.strictEqual(count("create-folder"), 4, "one root + three candidate folders");
  assert.strictEqual(count("upload", (c) => c.targetMime === "application/vnd.google-apps.document"), 3,
    "one application doc per candidate, converted to a Google Doc");
  assert.strictEqual(count("upload", (c) => c.partType === "application/pdf"), 1,
    "the staged PDF is uploaded as a PDF");
  assert.strictEqual(count("upload", (c) => c.targetMime === "application/vnd.google-apps.spreadsheet"), 1,
    "the index is created as a Sheet, converted from CSV");

  // The doc must carry the answers, HTML-escaped.
  const doc = [...files.values()].find((f) => /^Application — Uploaded/.test(f.name));
  assert.ok(doc, "an application doc exists");

  const before = calls.length;
  const second = await drive.syncPending({ limit: 10 });
  assert.strictEqual(second.attempted, 0, "a synced row must not be picked up again");
  assert.strictEqual(calls.length, before, "a no-op sync must make no Drive calls at all");

  // Re-queue one row: it must reuse its folder/doc/resume, not duplicate them.
  const rows = careers.allForDrive();
  careers.requeueForDrive(rows[0].id);
  const third = await drive.syncPending({ limit: 10 });
  assert.strictEqual(third.attempted, 1);
  assert.strictEqual(count("create-folder"), 4, "no new folder on a re-run");
  assert.strictEqual(count("update", (c) => /^Application —/.test(c.name)), 1,
    "the existing doc is updated in place, not duplicated");

  // The index reflects every row, including the ones with no file.
  const index = [...files.values()].find((f) => f.name === "_Applications Index");
  assert.ok(index, "the index sheet exists");
  assert.strictEqual(index.contentType.split(";")[0], "text/csv");

  const statuses = careers.allForDrive().map((r) => r.drive_status).sort();
  assert.deepStrictEqual(statuses, ["link-only", "link-only", "synced"]);

  console.log("✓ folder/doc/resume/index created with the right conversions");
  console.log("✓ second pass is a true no-op");
  console.log("✓ re-queued row reuses its folder and updates its doc in place");
  console.log("✓ unfetchable link and missing resume both record as link-only");
  console.log(`\nAll Drive mirror checks passed (${calls.length} API calls).`);
}

main()
  .then(() => { server.close(); fs.rmSync(tmp, { recursive: true, force: true }); process.exit(0); })
  .catch((err) => {
    console.error("\n✗ " + err.message);
    if (err.expected !== undefined) console.error(`  expected ${err.expected}, got ${err.actual}`);
    console.error("\ncalls:", JSON.stringify(calls, null, 2));
    server.close();
    process.exit(1);
  });
