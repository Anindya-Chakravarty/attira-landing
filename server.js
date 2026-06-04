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
const compression = require("compression");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const waitlist = require("./db");
const { PostHog } = require("posthog-node");

const posthog = new PostHog(process.env.POSTHOG_API_KEY, {
  host: process.env.POSTHOG_HOST || "https://us.i.posthog.com",
  enableExceptionAutocapture: true,
});

const PORT = parseInt(process.env.PORT || "3000", 10);
const STATIC_DIR = __dirname;
// Optional secret that protects the CSV export endpoint. If unset, the
// HTTP export route is disabled (you can still run `npm run export`).
const ADMIN_KEY = process.env.ADMIN_KEY || "";

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);

/* ── Security headers (helmet) ──────────────────────────────────────
   CSP is tuned for this site: styles + the Google Fonts stylesheet,
   fonts from gstatic, images from self + data: URIs, scripts from self
   only. JSON-LD (<script type="application/ld+json">) is a data block,
   not executed, so it needs no script-src allowance. */
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "default-src": ["'self'"],
        "script-src": ["'self'"],
        "style-src": ["'self'", "https://fonts.googleapis.com"],
        "font-src": ["'self'", "https://fonts.gstatic.com"],
        "img-src": ["'self'", "data:"],
        "connect-src": ["'self'"],
        // contact.html submits via action="mailto:…", so allow the mailto scheme.
        "form-action": ["'self'", "mailto:"],
        "object-src": ["'none'"],
        "base-uri": ["'self'"],
        "frame-ancestors": ["'none'"],
        "upgrade-insecure-requests": null,
      },
    },
    // HSTS is only meaningful over HTTPS; enable when deployed behind TLS.
    hsts: false,
    crossOriginEmbedderPolicy: false,
  })
);

/* ── Gzip/Brotli compression for text assets (html/css/js/json) ─── */
app.use(compression());

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
    const distinctId = email.trim().toLowerCase();
    if (result.status === "created") {
      posthog.identify({
        distinctId,
        properties: {
          $set: { email: distinctId },
          $set_once: { waitlist_joined_at: new Date().toISOString() },
        },
      });
      posthog.capture({
        distinctId,
        event: "waitlist_signup",
        properties: {
          source: "website",
          $set: { email: distinctId },
        },
      });
    } else {
      posthog.capture({
        distinctId,
        event: "waitlist_signup_existing",
        properties: { source: "website" },
      });
    }
    return res.json({ ok: true, status: result.status });
  } catch (err) {
    console.error("waitlist insert failed:", err);
    posthog.captureException(err, undefined, { endpoint: "/api/waitlist" });
    posthog.capture({
      distinctId: "server",
      event: "waitlist_signup_failed",
      properties: { error: err && err.message, endpoint: "/api/waitlist" },
    });
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
  posthog.capture({
    distinctId: "admin",
    event: "waitlist_export_accessed",
    properties: { row_count: rows.length },
  });
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
      if (/\.html$/.test(filePath)) {
        // markup must always revalidate so new ?v= asset references are picked up
        res.setHeader("Cache-Control", "no-cache");
      } else if (/\.(css|js)$/.test(filePath)) {
        // css/js are ?v=-versioned in the HTML → safe to cache hard (1 year)
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      } else {
        // images / fonts / other static assets — cache a week
        res.setHeader("Cache-Control", "public, max-age=604800");
      }
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
  server.close(async () => {
    try { waitlist._db.close(); } catch (_) {}
    await posthog.shutdown();
    process.exit(0);
  });
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
