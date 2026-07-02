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
const og = require("./og");
const { PostHog } = require("posthog-node");

const posthog = new PostHog(process.env.POSTHOG_API_KEY, {
  host: process.env.POSTHOG_HOST || "https://us.i.posthog.com",
  enableExceptionAutocapture: true,
});

const PORT = parseInt(process.env.PORT || "3000", 10);
const STATIC_DIR = __dirname;
// Canonical public origin — used to build absolute URLs for link-unfurl OG
// tags and share-card images, which must point at attira.org regardless of
// the internal Cloud Run host the request actually lands on.
const PUBLIC_ORIGIN = (process.env.PUBLIC_ORIGIN || "https://attira.org").replace(/\/+$/, "");
// Optional secret that protects the CSV export endpoint. If unset, the
// HTTP export route is disabled (you can still run `npm run export`).
const ADMIN_KEY = process.env.ADMIN_KEY || "";

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);

/* ── Security headers (helmet) ──────────────────────────────────────
   CSP is tuned for this site: styles + the Google Fonts stylesheet,
   fonts from gstatic, images from self + data: URIs. Scripts are self
   only (the PostHog init is self-hosted in ph-init.js — no inline JS),
   with PostHog's asset CDN allowed so array.js can load and its capture
   endpoint allowed via connect-src. JSON-LD (<script type="application/
   ld+json">) is a data block, not executed, so it needs no allowance. */
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "default-src": ["'self'"],
        "script-src": ["'self'", "https://us-assets.i.posthog.com"],
        "style-src": ["'self'", "https://fonts.googleapis.com"],
        "font-src": ["'self'", "https://fonts.gstatic.com"],
        "img-src": ["'self'", "data:"],
        // PostHog: load array.js from the asset CDN, send events to the API host.
        "connect-src": ["'self'", "https://us.i.posthog.com", "https://us-assets.i.posthog.com"],
        // posthog-js spins up a web worker from a blob: URL for batching.
        "worker-src": ["'self'", "blob:"],
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
  handler(req, res) {
    posthog.capture({
      distinctId: "anonymous",
      event: "waitlist_rate_limited",
      properties: { endpoint: "/api/waitlist", ip: req.ip },
    });
    res.status(429).json({ error: "Too many requests. Please slow down and try again shortly." });
  },
});

/* ── Email validation ───────────────────────────────────────────── */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
function isValidEmail(v) {
  return typeof v === "string" && v.length <= 254 && EMAIL_RE.test(v);
}

/* ── Referral share-code validation ─────────────────────────────────
   Share codes look like ATR-XXXXX. Anything else is dropped silently so
   a typo'd or crafted ?ref= can never break a signup. */
const SHARE_CODE_RE = /^ATR-[A-Z0-9]{5}$/;
function sanitizeRef(v) {
  if (typeof v !== "string") return undefined;
  const code = v.trim().toUpperCase();
  return SHARE_CODE_RE.test(code) ? code : undefined;
}

/* ── Share-channel validation ───────────────────────────────────────
   The `c=` tag carried by referral links records which surface a referee
   came through. Whitelisted so it's safe to store and to break funnels by.
     wa WhatsApp · ig Instagram · tt TikTok · x X · dm direct message
     em email · cp copied link · other anything else explicitly tagged */
const CHANNELS = new Set(["wa", "ig", "tt", "x", "dm", "em", "cp", "other"]);
function sanitizeChannel(v) {
  if (typeof v !== "string") return undefined;
  const c = v.trim().toLowerCase().slice(0, 8);
  return CHANNELS.has(c) ? c : undefined;
}

/* ── UTM sanitisation ───────────────────────────────────────────── */
// Keep only known UTM keys and cap their length so a crafted request
// can't bloat events or the database.
const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"];
function sanitizeUtm(raw) {
  const out = {};
  if (!raw || typeof raw !== "object") return out;
  for (const key of UTM_KEYS) {
    const val = raw[key];
    if (typeof val === "string" && val.trim()) {
      out[key] = val.trim().slice(0, 200);
    }
  }
  return out;
}

/* ── Build the stats payload shared by signup + stats endpoints ────── */
function statsFor(shareCode, referralCount, createdAt, referredByCode) {
  return {
    shareCode,
    referralCount,
    position: waitlist.computePosition(referralCount, createdAt),
    total: waitlist.totalCount(),
    reward: waitlist.rewardFor(referralCount, referredByCode),
    leaderboard: waitlist.buildLeaderboard(),
  };
}

/* ── API: join the waitlist ─────────────────────────────────────── */
app.post("/api/waitlist", signupLimiter, (req, res) => {
  const { email } = req.body || {};
  const utm = sanitizeUtm(req.body && req.body.utm);
  const ref = sanitizeRef(req.body && req.body.ref);
  const channel = sanitizeChannel(req.body && req.body.channel);
  if (!isValidEmail(email)) {
    posthog.capture({
      distinctId: "anonymous",
      event: "waitlist_invalid_email",
      properties: { endpoint: "/api/waitlist" },
    });
    return res.status(400).json({ ok: false, error: "Please enter a valid email." });
  }
  try {
    const result = waitlist.addEmail({
      email,
      source: utm.utm_source || "website",
      userAgent: req.get("user-agent") || "",
      utm,
      ref,
      channel,
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
          source: utm.utm_source || "website",
          ...utm,
          share_code: result.shareCode,
          referred_by: ref || null,
          share_channel: ref ? channel || null : null,
          $set: { email: distinctId },
        },
      });
    } else {
      posthog.capture({
        distinctId,
        event: "waitlist_signup_existing",
        properties: {
          source: utm.utm_source || "website",
          ...utm,
          share_code: result.shareCode,
          referral_count: result.referralCount,
        },
      });
    }
    // Re-read the row so position/referral_count reflect any same-request
    // bump (e.g. this very signup may have moved the referrer, not us).
    const row = waitlist.getByShareCode(result.shareCode);
    const stats = row
      ? statsFor(row.share_code, row.referral_count, row.created_at, row.referred_by_code)
      : { shareCode: result.shareCode, referralCount: result.referralCount, position: null, total: waitlist.totalCount(), reward: waitlist.rewardFor(result.referralCount, ref), leaderboard: waitlist.buildLeaderboard() };
    return res.json({
      ok: true,
      status: result.status,
      alreadyJoined: result.status === "existing",
      ...stats,
    });
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

/* ── API: stats for one share code (powers the returning dashboard) ── */
app.get("/api/waitlist/stats", (req, res) => {
  const code = sanitizeRef(req.query.code);
  if (!code) return res.status(400).json({ ok: false, error: "Invalid code." });
  const row = waitlist.getByShareCode(code);
  if (!row) return res.status(404).json({ ok: false, error: "Not found." });
  res.json({ ok: true, ...statsFor(row.share_code, row.referral_count, row.created_at, row.referred_by_code) });
});

/* ── API: public stats (total + leaderboard) for first-time visitors ── */
app.get("/api/waitlist/public", (req, res) => {
  res.json({
    ok: true,
    total: waitlist.totalCount(),
    leaderboard: waitlist.buildLeaderboard(),
  });
});

/* ── API: public queue in signup order (powers /queue) ──────────────
   Masked emails only, paginated. Separate from the referral leaderboard. */
app.get("/api/waitlist/queue", (req, res) => {
  const limit = parseInt(req.query.limit, 10) || 100;
  const offset = parseInt(req.query.offset, 10) || 0;
  res.json({ ok: true, ...waitlist.queue({ limit, offset }) });
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
  // Real signups only — seed rows are for public social proof, never outreach.
  const rows = waitlist.exportReal();
  posthog.capture({
    distinctId: "admin",
    event: "waitlist_export_accessed",
    properties: { row_count: rows.length },
  });
  const header =
    "id,email,source,utm_source,utm_medium,utm_campaign,user_agent," +
    "share_code,referred_by_code,referred_via_channel,referral_count,created_at\n";
  const body = rows
    .map((r) =>
      [
        r.id,
        r.email,
        r.source,
        r.utm_source,
        r.utm_medium,
        r.utm_campaign,
        r.user_agent,
        r.share_code,
        r.referred_by_code,
        r.referred_via_channel,
        r.referral_count,
        r.created_at,
      ]
        .map(csvEscape)
        .join(",")
    )
    .join("\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="attira-waitlist.csv"');
  res.send(header + body + "\n");
});

/* ── HTML-escape helper for the unfurl page's interpolated values ── */
function htmlEscape(v) {
  return String(v == null ? "" : v).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

/* ── Dynamic OG card image for a referral code ──────────────────────
   Served same-origin (CSP img-src 'self' already allows it). Falls back
   to the static brand image so a render failure never breaks an unfurl. */
app.get("/api/og/:code.png", async (req, res) => {
  const code = sanitizeRef(req.params.code);
  if (!code) return res.redirect(302, "/assets/og-image.png");
  try {
    const row = waitlist.getByShareCode(code);
    if (!row) return res.redirect(302, "/assets/og-image.png");
    const png = await og.renderCard({
      code,
      position: waitlist.computePosition(row.referral_count, row.created_at),
      referralCount: row.referral_count,
    });
    res.setHeader("Content-Type", "image/png");
    // Position can change as friends join, so cache only briefly.
    res.setHeader("Cache-Control", "public, max-age=300");
    res.send(png);
  } catch (err) {
    console.error("og render failed:", err && err.message);
    posthog.captureException(err, undefined, { endpoint: "/api/og" });
    res.redirect(302, "/assets/og-image.png");
  }
});

/* ── Referral short links: /r/ATR-XXXXX ─────────────────────────────
   Registered before the static handler so it isn't shadowed by a file.

   Serves a tiny HTML shell carrying PER-REFERRER OG tags (so the link
   unfurls personally in WhatsApp/iMessage/X) and immediately bounces a
   real browser on to /?ref=CODE&c=CHANNEL via meta-refresh + JS. Crawlers
   read the static <meta>; humans never see the page. Falls back to a
   plain redirect for invalid/unknown codes. The optional ?c= tag records
   which share surface the click came from. */
app.get("/r/:code", (req, res) => {
  const code = sanitizeRef(req.params.code);
  const channel = sanitizeChannel(req.query.c);
  if (!code) return res.redirect(302, "/");

  const dest = `/?ref=${code}${channel ? `&c=${channel}` : ""}`;
  const row = waitlist.getByShareCode(code);
  if (!row) return res.redirect(302, dest); // unknown code → still let them join

  const position = waitlist.computePosition(row.referral_count, row.created_at);
  const title = `Join the Attira waitlist — skip ahead together`;
  const desc = position
    ? `Your friend is #${position.toLocaleString()} in line. Join with their link and you both move up the queue.`
    : `Join with your friend's link and you both move up the queue.`;
  const ogImg = `${PUBLIC_ORIGIN}/api/og/${code}.png`;
  const canonical = `${PUBLIC_ORIGIN}${dest}`;

  res.setHeader("Cache-Control", "no-cache");
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="robots" content="noindex, nofollow" />
<title>${htmlEscape(title)}</title>
<meta name="description" content="${htmlEscape(desc)}" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="Attira" />
<meta property="og:title" content="${htmlEscape(title)}" />
<meta property="og:description" content="${htmlEscape(desc)}" />
<meta property="og:url" content="${htmlEscape(canonical)}" />
<meta property="og:image" content="${htmlEscape(ogImg)}" />
<meta property="og:image:width" content="${og.WIDTH}" />
<meta property="og:image:height" content="${og.HEIGHT}" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${htmlEscape(title)}" />
<meta name="twitter:description" content="${htmlEscape(desc)}" />
<meta name="twitter:image" content="${htmlEscape(ogImg)}" />
<meta http-equiv="refresh" content="0; url=${htmlEscape(dest)}" />
<link rel="canonical" href="${htmlEscape(canonical)}" />
</head>
<body>
<p>Redirecting you to the Attira waitlist… <a href="${htmlEscape(dest)}">Continue</a></p>
<script>location.replace(${JSON.stringify(dest)});</script>
</body>
</html>`);
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
