/* ===================================================================
   Attira — mirror job applications into Google Drive

   Every application becomes:

     Attira Applications/                  ← created by this worker
       _Applications Index                 ← one Google Sheet, all roles
       ATR-APP-XXXXX — Name/
         Application — Name                ← Google Doc, every answer
         resume.pdf                        ← the uploaded file, or a copy
                                             of whatever link they pasted

   ── Why OAuth as a human, not the Cloud Run service account ──
   This GCP account has no Google Workspace, so there are no Shared
   Drives and no domain-wide delegation. A service account has zero
   Drive storage quota, so anything it uploads into a personal My Drive
   fails with storageQuotaExceeded. The only route is a refresh token
   for a real account (ootfits3@gmail.com — the account that owns the
   applications folder, NOT the jodmcp@ account that owns the GCP
   project), stored in Secret Manager.

   ── Why the drive.file scope ──
   Full `drive` is a RESTRICTED scope: an app using it cannot leave
   "Testing" publishing status without a CASA assessment, and Testing
   refresh tokens expire every 7 days — this pipeline would break weekly
   and silently. `drive.file` is non-sensitive, publishes immediately,
   and its token does not expire. The cost is that this worker can only
   touch files IT created, which is why it creates its own root folder
   rather than writing into a pre-existing one. Move that folder wherever
   you like afterwards; per-file access follows the file, not the path.

   That scope choice is also why the index is a Sheet written through the
   DRIVE api (upload CSV, let Drive convert) instead of the Sheets API —
   `spreadsheets` is a sensitive scope and would drag verification back in.
   =================================================================== */

const { OAuth2Client } = require("google-auth-library");
const careers = require("./careers-db");
const xport = require("./careers-export");
const roles = require("./careers-roles");
const uploads = require("./careers-uploads");

const ROOT_FOLDER_NAME = process.env.DRIVE_ROOT_FOLDER || "Attira Applications";
const INDEX_NAME = process.env.DRIVE_INDEX_NAME || "_Applications Index";

/* Overridable so the mock harness in scripts/test-drive-mock.js can
   exercise the request envelopes without touching Google. */
const API = process.env.DRIVE_API_BASE || "https://www.googleapis.com";

const FOLDER_MIME = "application/vnd.google-apps.folder";
const DOC_MIME = "application/vnd.google-apps.document";
const SHEET_MIME = "application/vnd.google-apps.spreadsheet";

/* A resume we fetch from a pasted link is capped well below the upload
   limit — anything larger is not a resume. */
const MAX_LINK_BYTES = 15 * 1024 * 1024;
const LINK_TIMEOUT_MS = 20000;

/* ── config ──────────────────────────────────────────────────────────
   DRIVE_OAUTH holds {client_id, client_secret, refresh_token} as JSON
   (Secret Manager → env). Absent means "Drive mirroring is off", which
   is the correct behaviour for a local dev server: applications still
   save, they just stay pending until a configured process picks them up. */
let cachedClient = null;
let configError = null;

function config() {
  const raw = process.env.DRIVE_OAUTH;
  if (!raw) return null;
  try {
    const c = JSON.parse(raw);
    if (!c.client_id || !c.client_secret || !(c.refresh_token || c.access_token)) {
      throw new Error("needs client_id, client_secret and refresh_token");
    }
    return c;
  } catch (err) {
    // Logged once by isConfigured() rather than on every call.
    configError = `DRIVE_OAUTH is not usable: ${err.message}`;
    return null;
  }
}

function isConfigured() {
  return !!config();
}

function client() {
  if (cachedClient) return cachedClient;
  const c = config();
  if (!c) throw new Error(configError || "DRIVE_OAUTH is not set");
  const oauth = new OAuth2Client(c.client_id, c.client_secret);
  /* An access_token in the blob is honoured as-is — that's how you can
     try this against a token from the OAuth Playground, or run the test
     harness, without minting a refresh token first. */
  oauth.setCredentials(
    c.access_token
      ? { access_token: c.access_token, expiry_date: Date.now() + 55 * 60 * 1000 }
      : { refresh_token: c.refresh_token }
  );
  cachedClient = oauth;
  return cachedClient;
}

async function authHeader() {
  const token = await client().getAccessToken();
  const value = typeof token === "string" ? token : token && token.token;
  if (!value) throw new Error("Could not obtain a Drive access token");
  return `Bearer ${value}`;
}

/* ── Drive REST v3 ───────────────────────────────────────────────────
   Called with fetch rather than the `googleapis` package: this needs
   five endpoints, and that dependency is ~50MB in the image. */

async function driveFetch(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { Authorization: await authHeader(), ...(options.headers || {}) },
  });
  const text = await res.text();
  if (!res.ok) {
    let detail = text.slice(0, 400);
    try {
      const parsed = JSON.parse(text);
      if (parsed.error && parsed.error.message) detail = parsed.error.message;
    } catch (e) { /* keep the raw body */ }
    const err = new Error(`Drive ${res.status}: ${detail}`);
    err.status = res.status;
    throw err;
  }
  return text ? JSON.parse(text) : {};
}

/* Single quotes terminate a Drive query string literal. */
function q(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function findFile({ name, parentId, mimeType }) {
  const clauses = [`name = '${q(name)}'`, "trashed = false"];
  if (parentId) clauses.push(`'${q(parentId)}' in parents`);
  if (mimeType) clauses.push(`mimeType = '${q(mimeType)}'`);
  const url =
    `${API}/drive/v3/files?` +
    new URLSearchParams({
      q: clauses.join(" and "),
      fields: "files(id,name,webViewLink)",
      pageSize: "10",
      spaces: "drive",
    });
  const out = await driveFetch(url);
  return (out.files && out.files[0]) || null;
}

async function createFolder(name, parentId) {
  return driveFetch(`${API}/drive/v3/files?fields=id,webViewLink`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      mimeType: FOLDER_MIME,
      ...(parentId ? { parents: [parentId] } : {}),
    }),
  });
}

/* multipart/related upload — metadata part, then the bytes. Hand-built
   because Drive requires this exact envelope and the body may be binary. */
async function uploadFile({ name, parentId, contentType, data, targetMime, fileId }) {
  const boundary = "attira" + Math.random().toString(36).slice(2) + Date.now().toString(36);
  const metadata = fileId
    ? { name }
    : {
        name,
        ...(targetMime ? { mimeType: targetMime } : {}),
        ...(parentId ? { parents: [parentId] } : {}),
      };
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
        `${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`
    ),
    Buffer.isBuffer(data) ? data : Buffer.from(data),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);

  const base = `${API}/upload/drive/v3/files`;
  const url = fileId
    ? `${base}/${encodeURIComponent(fileId)}?uploadType=multipart&fields=id,webViewLink`
    : `${base}?uploadType=multipart&fields=id,webViewLink`;

  return driveFetch(url, {
    method: fileId ? "PATCH" : "POST",
    headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
    body,
  });
}

function fileUrl(id) {
  return id ? `https://drive.google.com/file/d/${id}/view` : "";
}
function folderUrl(id) {
  return id ? `https://drive.google.com/drive/folders/${id}` : "";
}
function docUrl(id) {
  return id ? `https://docs.google.com/document/d/${id}/edit` : "";
}

/* ── folders ─────────────────────────────────────────────────────── */

let rootFolderId = null;

async function ensureRootFolder() {
  if (rootFolderId) return rootFolderId;
  if (process.env.DRIVE_ROOT_FOLDER_ID) {
    rootFolderId = process.env.DRIVE_ROOT_FOLDER_ID;
    return rootFolderId;
  }
  const found = await findFile({ name: ROOT_FOLDER_NAME, mimeType: FOLDER_MIME });
  const folder = found || (await createFolder(ROOT_FOLDER_NAME, null));
  if (!found) {
    console.log(JSON.stringify({
      event: "drive_root_created", id: folder.id, name: ROOT_FOLDER_NAME,
      note: "Move this folder wherever you want it — app access follows the file.",
    }));
  }
  rootFolderId = folder.id;
  return rootFolderId;
}

/* Drive happily creates two folders with the same name, so a re-run must
   look before it leaps: reuse the recorded id, else search, else create. */
async function ensureCandidateFolder(row) {
  if (row.drive_folder_id) return row.drive_folder_id;
  const parent = await ensureRootFolder();
  const name = `${row.ref} — ${row.full_name || "Unnamed"}`.slice(0, 200);
  const found = await findFile({ name, parentId: parent, mimeType: FOLDER_MIME });
  const folder = found || (await createFolder(name, parent));
  careers.noteDriveProgress(row.id, { folderId: folder.id });
  return folder.id;
}

/* ── the application document ────────────────────────────────────── */

function esc(v) {
  return String(v === null || v === undefined ? "" : v)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/* Answers are frequently URLs (portfolio, reel, best account). Rendering
   them as links is the difference between a doc you can work from and one
   you have to copy-paste out of. */
function asHtml(value) {
  const text = esc(value).replace(/\r\n/g, "\n");
  const linked = text.replace(/https?:\/\/[^\s<]+/g, (u) => `<a href="${u}">${u}</a>`);
  return linked.replace(/\n/g, "<br>");
}

function money(amount, currency) {
  if (amount === null || amount === undefined || amount === "") return "—";
  const symbol = (roles.CURRENCIES.find((c) => c.value === currency) || {}).symbol || "";
  return `${symbol}${Number(amount).toLocaleString("en-IN")}`;
}

function renderApplicationHtml(row) {
  const role = roles.findRole(row.role);
  const answers = xport.parseAnswers(row);
  const rows = [];

  const add = (label, value) => {
    if (value === "" || value === null || value === undefined) return;
    rows.push(
      `<tr><td style="padding:6px 14px 6px 0;vertical-align:top;width:210px">` +
        `<b>${esc(label)}</b></td><td style="padding:6px 0">${asHtml(value)}</td></tr>`
    );
  };

  add("Email", row.email);
  add("Phone", row.phone);
  add("Location", row.location);
  add("Current compensation", money(row.current_comp, row.comp_currency));
  add("Expected compensation", money(row.expected_comp, row.comp_currency));
  add("Resume link", row.resume_url);
  add("Source", row.utm_source);

  const questions = [];
  for (const field of xport.roleFields(row.role)) {
    let value = xport.cellFor(field, answers[field.name]);
    if (field.type === "tags" && answers[field.name + "Other"]) {
      value = value ? `${value}, ${answers[field.name + "Other"]}` : answers[field.name + "Other"];
    }
    if (value === "" || value === null || value === undefined) continue;
    questions.push(
      `<p style="margin:18px 0 4px"><b>${esc(field.csvLabel || field.label || field.name)}</b></p>` +
        `<p style="margin:0">${asHtml(value)}</p>`
    );
  }

  return `<html><body style="font-family:Arial,sans-serif;font-size:11pt;color:#111">
<h1 style="font-size:20pt;margin:0 0 2px">${esc(row.full_name)}</h1>
<p style="margin:0 0 18px;color:#555">
  ${esc(role ? role.title : row.role)} · ${esc(row.ref)} · applied ${esc((row.created_at || "").replace("T", " "))}
</p>
<table style="border-collapse:collapse">${rows.join("")}</table>
${questions.join("")}
${row.anything_else ? `<p style="margin:18px 0 4px"><b>Anything else</b></p><p style="margin:0">${asHtml(row.anything_else)}</p>` : ""}
</body></html>`;
}

async function ensureApplicationDoc(row, folderId) {
  const html = renderApplicationHtml(row);
  const name = `Application — ${row.full_name || row.ref}`.slice(0, 200);
  // Re-running refreshes the doc in place instead of leaving a stale copy.
  const created = await uploadFile({
    name,
    parentId: folderId,
    contentType: "text/html; charset=UTF-8",
    data: Buffer.from(html, "utf8"),
    targetMime: DOC_MIME,
    fileId: row.drive_doc_id || null,
  });
  careers.noteDriveProgress(row.id, { docId: created.id });
  return created.id;
}

/* ── the resume ──────────────────────────────────────────────────── */

function parseKeys(row) {
  try {
    const parsed = JSON.parse(row.file_keys || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

/* A Drive "view" URL serves an HTML page, not the file. This is the
   download form — the same rewrite you'd do by hand. */
function directDownloadUrl(url) {
  const m = /drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?[^#]*id=)([A-Za-z0-9_-]{10,})/.exec(url);
  if (m) return `https://drive.google.com/uc?export=download&id=${m[1]}`;
  const doc = /docs\.google\.com\/document\/d\/([A-Za-z0-9_-]{10,})/.exec(url);
  if (doc) return `https://docs.google.com/document/d/${doc[1]}/export?format=pdf`;
  return url;
}

/* Drive serves a shared PDF as application/octet-stream, and a file that
   arrives with no type and no extension gets no preview and no icon —
   so the bytes decide, with the declared type only as a fallback. */
function describe(buffer, declaredType, fallbackName) {
  const sniffed = uploads.sniff(buffer);
  if (sniffed) return { contentType: sniffed.contentType, ext: sniffed.ext };
  const m = /(\.[A-Za-z0-9]{1,5})(?:[?#]|$)/.exec(fallbackName || "");
  return {
    contentType: declaredType || "application/octet-stream",
    ext: m ? m[1].toLowerCase() : "",
  };
}

/* Fetch a pasted link anonymously — these are anyone-with-link files, so
   no Drive scope is involved (and drive.file could not read someone
   else's file anyway). Returns null when the link isn't a document:
   an Instagram profile, a Notion page or a private file all land here,
   and inventing a file for them would be worse than recording the URL. */
async function fetchLinkedResume(url) {
  const target = directDownloadUrl(url);
  let res;
  try {
    res = await fetch(target, {
      redirect: "follow",
      signal: AbortSignal.timeout(LINK_TIMEOUT_MS),
      headers: { "User-Agent": "AttiraCareers/1.0 (+https://attira.org)" },
    });
  } catch (err) {
    return { ok: false, reason: `fetch failed: ${err.message}` };
  }
  if (!res.ok) return { ok: false, reason: `link returned HTTP ${res.status}` };

  const contentType = (res.headers.get("content-type") || "").split(";")[0].trim();
  if (/^text\/html/.test(contentType)) {
    // Drive's virus-scan interstitial and every "you need access" page.
    return { ok: false, reason: "link resolves to a web page, not a file" };
  }

  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length) return { ok: false, reason: "link returned an empty file" };
  if (buf.length > MAX_LINK_BYTES) return { ok: false, reason: "linked file is too large" };
  return { ok: true, buffer: buf, contentType: contentType || "application/octet-stream" };
}

/* Returns 'file' when bytes reached Drive, 'link-only' when all we have
   is a URL we could not turn into a file, or 'none'. */
async function ensureResume(row, folderId) {
  if (row.drive_resume_id) return { outcome: "file", id: row.drive_resume_id };

  const put = async (buffer, declaredType, nameHint) => {
    const what = describe(buffer, declaredType, nameHint);
    const created = await uploadFile({
      name: `Resume — ${row.full_name || row.ref}${what.ext}`.slice(0, 200),
      parentId: folderId,
      contentType: what.contentType,
      data: buffer,
    });
    careers.noteDriveProgress(row.id, { resumeId: created.id });
    return { outcome: "file", id: created.id };
  };

  const keys = parseKeys(row);
  if (keys.length) {
    const staged = await uploads.getStaged(keys[0]);
    return put(staged.buffer, staged.contentType, staged.originalName);
  }

  if (row.resume_url) {
    const fetched = await fetchLinkedResume(row.resume_url);
    if (!fetched.ok) return { outcome: "link-only", reason: fetched.reason };
    return put(fetched.buffer, fetched.contentType, row.resume_url);
  }

  return { outcome: "none" };
}

/* ── the index sheet ─────────────────────────────────────────────── */

function linksFor(row) {
  return {
    folderUrl: folderUrl(row.drive_folder_id),
    docUrl: docUrl(row.drive_doc_id),
    resumeUrl: row.drive_resume_id ? fileUrl(row.drive_resume_id) : row.resume_url || "",
  };
}

/* Rewritten in full on every sync rather than appended to. At this volume
   that costs one small upload, and it means the sheet is always a true
   reflection of the database — including rows fixed or retried later. */
async function rebuildIndex() {
  const parent = await ensureRootFolder();
  const rows = careers.allForDrive();
  const linksByRef = {};
  for (const r of rows) linksByRef[r.ref] = linksFor(r);
  const csv = xport.indexCsv(rows, linksByRef);

  const existing = await findFile({ name: INDEX_NAME, parentId: parent, mimeType: SHEET_MIME });
  const saved = await uploadFile({
    name: INDEX_NAME,
    parentId: parent,
    contentType: "text/csv; charset=UTF-8",
    data: Buffer.from("﻿" + csv, "utf8"),
    targetMime: SHEET_MIME,
    fileId: existing ? existing.id : null,
  });
  return { id: saved.id, rows: rows.length };
}

/* ── the worker ──────────────────────────────────────────────────── */

async function syncOne(row) {
  careers.noteDriveAttempt(row.id);
  const folderId = await ensureCandidateFolder(row);
  // Re-read so the doc/resume steps see ids written by ensureCandidateFolder.
  const fresh = careers.getForDrive(row.id) || row;
  await ensureApplicationDoc(fresh, folderId);
  const resume = await ensureResume(careers.getForDrive(row.id) || fresh, folderId);

  const status = resume.outcome === "file" ? "synced" : "link-only";
  const done = careers.getForDrive(row.id);
  careers.markDriveSynced(row.id, {
    status,
    folderId,
    docId: done.drive_doc_id,
    resumeId: done.drive_resume_id,
  });
  return { ref: row.ref, status, resume: resume.outcome, reason: resume.reason || null };
}

/* Two triggers share this worker (the post-response kick and the Cloud
   Scheduler endpoint), and Cloud Run runs a single instance — so an
   in-process guard is enough to stop them treading on each other. */
let inFlight = null;

async function syncPending({ limit = 20 } = {}) {
  if (!isConfigured()) return { skipped: "DRIVE_OAUTH not configured" };
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const pending = careers.pendingForDrive(limit);
    const results = [];
    for (const row of pending) {
      try {
        results.push(await syncOne(row));
      } catch (err) {
        careers.markDriveFailed(row.id, err.message);
        results.push({ ref: row.ref, status: "error", error: err.message });
        console.error(`[careers-drive] ${row.ref} failed:`, err.message);
      }
    }
    let index = null;
    if (results.length) {
      try {
        index = await rebuildIndex();
      } catch (err) {
        console.error("[careers-drive] index rebuild failed:", err.message);
      }
    }
    const summary = {
      event: "careers_drive_sync",
      attempted: pending.length,
      synced: results.filter((r) => r.status === "synced").length,
      linkOnly: results.filter((r) => r.status === "link-only").length,
      failed: results.filter((r) => r.status === "error").length,
      indexRows: index ? index.rows : null,
      results,
    };
    if (results.length) console.log(JSON.stringify(summary));
    return summary;
  })().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

module.exports = {
  isConfigured,
  syncPending,
  syncOne,
  rebuildIndex,
  ensureRootFolder,
  renderApplicationHtml,
  directDownloadUrl,
  fetchLinkedResume,
  ROOT_FOLDER_NAME,
};
