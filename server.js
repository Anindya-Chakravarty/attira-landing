/* ===================================================================
   Attira — web server + waitlist email capture
   Serves the static landing site AND exposes a small API that saves
   every "Get early access" email into the SQLite database (see db.js).

   Run it:   npm install   then   npm start
   Visit:    http://localhost:3000
   =================================================================== */

const path = require("path");
const crypto = require("crypto");
const express = require("express");
const rateLimit = require("express-rate-limit");
const waitlist = require("./db");

const PORT = parseInt(process.env.PORT || "3000", 10);
const STATIC_DIR = __dirname;
// Optional secret that protects the CSV export endpoint. If unset, the
// HTTP export route is disabled (you can still run `npm run export`).
const ADMIN_KEY = process.env.ADMIN_KEY || "";

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(express.json({ limit: "16kb" }));

/* ── Rate limit the signup endpoint (anti-spam) ─────────────────── */
const signupLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please slow down and try again shortly." },
});

/* ── Email validation ───────────────────────────────────────────── */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
function isValidEmail(v) {
  return typeof v === "string" && v.length <= 254 && EMAIL_RE.test(v);
}

/* ── API: join the waitlist ─────────────────────────────────────── */
app.post("/api/waitlist", signupLimiter, (req, res) => {
  const { email } = req.body || {};
  if (!isValidEmail(email)) {
    return res.status(400).json({ ok: false, error: "Please enter a valid email." });
  }
  try {
    const result = waitlist.addEmail({
      email,
      source: "website",
      userAgent: req.get("user-agent") || "",
    });
    return res.json({ ok: true, status: result.status });
  } catch (err) {
    console.error("waitlist insert failed:", err);
    return res
      .status(500)
      .json({ ok: false, error: "Something went wrong. Please try again in a moment." });
  }
});

/* ── API: how many signups so far (handy to check it's working) ─── */
app.get("/api/waitlist/count", (req, res) => {
  res.json({ count: waitlist.totalCount() });
});

/* ── Admin: download all emails as CSV ──────────────────────────────
   Gated by the ADMIN_KEY env var. Send it as ?key=... in the URL or as
   an `Authorization: Bearer <key>` header. Disabled when ADMIN_KEY unset. */
function csvEscape(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function adminKeyMatches(req) {
  if (!ADMIN_KEY) return false;
  const header = req.get("authorization") || "";
  const m = /^Bearer\s+(.+)$/i.exec(header);
  const provided = m ? m[1] : req.query.key || "";
  if (!provided) return false;
  const a = Buffer.from(String(provided));
  const b = Buffer.from(ADMIN_KEY);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

app.get("/api/waitlist/export", (req, res) => {
  if (!adminKeyMatches(req)) return res.status(404).end();
  const rows = waitlist.exportAll();
  const header = "id,email,source,user_agent,created_at\n";
  const body = rows
    .map((r) => [r.id, r.email, r.source, r.user_agent, r.created_at].map(csvEscape).join(","))
    .join("\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="attira-waitlist.csv"');
  res.send(header + body + "\n");
});

/* ── Static landing site (index.html, legal pages, assets, …) ───── */
app.use(
  express.static(STATIC_DIR, {
    extensions: ["html"],
    setHeaders(res, filePath) {
      res.setHeader(
        "Cache-Control",
        filePath.endsWith(".html") ? "no-cache" : "public, max-age=3600"
      );
    },
  })
);

app.get("/", (req, res) => res.sendFile(path.join(STATIC_DIR, "index.html")));

/* ── Start ──────────────────────────────────────────────────────── */
const server = app.listen(PORT, () => {
  console.log(`\nAttira site + waitlist running →  http://localhost:${PORT}`);
  console.log(`Emails are saved to: ${waitlist.DB_PATH}`);
  console.log(`Export anytime with:  npm run export\n`);
  if (!ADMIN_KEY) {
    console.warn("[note] ADMIN_KEY not set — the /api/waitlist/export URL is disabled (use `npm run export`).");
  }
});

function shutdown() {
  server.close(() => {
    try { waitlist._db.close(); } catch (_) {}
    process.exit(0);
  });
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
