/* ===================================================================
   Attira — staging for uploaded resumes

   An applicant's file arrives at /api/careers/upload before they press
   Send, and is collected later by careers-drive.js. In between it needs
   to sit somewhere DURABLE:

     • not in the JSON payload — express.json caps bodies at 64kb,
     • not on the Cloud Run filesystem — that's tmpfs, so it counts
       against the 512Mi memory limit and evaporates on the next
       revision, losing a resume the applicant was told we'd received.

   So: GCS in production (the Litestream bucket already exists and the
   runtime service account can already write to it), and a folder under
   DATA_DIR when DRIVE_UPLOAD_BUCKET is unset, so a local dev server can
   run the whole pipeline without cloud credentials.
   =================================================================== */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const BUCKET = process.env.DRIVE_UPLOAD_BUCKET || "";
const PREFIX = process.env.DRIVE_UPLOAD_PREFIX || "careers-uploads";
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const LOCAL_DIR = path.join(DATA_DIR, "uploads");

let bucketHandle = null;
function bucket() {
  if (!bucketHandle) {
    const { Storage } = require("@google-cloud/storage");
    bucketHandle = new Storage().bucket(BUCKET);
  }
  return bucketHandle;
}

function usingGcs() {
  return !!BUCKET;
}

/* Keys carry their own backend so a row staged locally can never be
   mistaken for a GCS object after the env changes underneath it. */
function newKey() {
  const id = crypto.randomUUID();
  return usingGcs() ? `${PREFIX}/${id}` : `local:${id}`;
}

async function putStaged(buffer, { contentType, originalName } = {}) {
  const key = newKey();
  const meta = {
    contentType: contentType || "application/octet-stream",
    originalName: String(originalName || "").slice(0, 200),
  };

  if (key.startsWith("local:")) {
    fs.mkdirSync(LOCAL_DIR, { recursive: true });
    const base = path.join(LOCAL_DIR, key.slice("local:".length));
    fs.writeFileSync(base, buffer);
    fs.writeFileSync(base + ".json", JSON.stringify(meta));
    return key;
  }

  await bucket().file(key).save(buffer, {
    resumable: false,
    contentType: meta.contentType,
    metadata: { metadata: { originalName: meta.originalName } },
  });
  return key;
}

async function getStaged(key) {
  if (String(key).startsWith("local:")) {
    const base = path.join(LOCAL_DIR, String(key).slice("local:".length));
    // path.join with a crafted key could escape LOCAL_DIR — refuse anything
    // that resolves outside it.
    if (!path.resolve(base).startsWith(path.resolve(LOCAL_DIR) + path.sep)) {
      throw new Error("refusing to read outside the upload directory");
    }
    const buffer = fs.readFileSync(base);
    let meta = {};
    try {
      meta = JSON.parse(fs.readFileSync(base + ".json", "utf8"));
    } catch (e) { /* metadata is a nicety, the bytes are the point */ }
    return {
      buffer,
      contentType: meta.contentType || "application/octet-stream",
      originalName: meta.originalName || "",
    };
  }

  const file = bucket().file(key);
  const [meta] = await file.getMetadata();
  const [buffer] = await file.download();
  return {
    buffer,
    contentType: meta.contentType || "application/octet-stream",
    originalName: (meta.metadata && meta.metadata.originalName) || "",
  };
}

/* ── what IS this file? ──────────────────────────────────────────────
   Trust the bytes, not the label. On the way in that stops a renamed
   .exe claiming to be application/pdf; on the way out it matters just as
   much, because Drive hands back "application/octet-stream" for a
   shared PDF and a file that reaches Drive with no type and no
   extension gets no preview and no icon. */
const SNIFF = [
  ["25504446", "application/pdf", ".pdf"],
  // ZIP container — .docx and its relatives all look like this.
  ["504B0304", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ".docx"],
  ["D0CF11E0", "application/msword", ".doc"],
  ["FFD8FF", "image/jpeg", ".jpg"],
  ["89504E47", "image/png", ".png"],
];

function sniff(buf) {
  if (!buf || buf.length < 8) return null;
  const hex = buf.subarray(0, 8).toString("hex").toUpperCase();
  for (const [magic, contentType, ext] of SNIFF) {
    if (hex.startsWith(magic)) return { contentType, ext };
  }
  return null;
}

/* An upload token is only meaningful if it looks like one of our keys —
   this is what stops a submitted payload naming an arbitrary object. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function isValidKey(key) {
  if (typeof key !== "string" || key.length > 200) return false;
  // Compared as literal strings rather than an interpolated regex: the
  // prefix is configurable, and building a pattern out of it is how a
  // "." quietly becomes "any character".
  if (key.startsWith("local:")) return UUID.test(key.slice("local:".length));
  if (key.startsWith(PREFIX + "/")) return UUID.test(key.slice(PREFIX.length + 1));
  return false;
}

module.exports = { putStaged, getStaged, isValidKey, sniff, usingGcs, LOCAL_DIR };
