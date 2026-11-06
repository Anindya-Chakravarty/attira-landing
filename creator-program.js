/* ===================================================================
   Attira creator referral program — website tier

   The Go API (ootfits-api) owns creator identity, referral codes,
   campaigns, clicks, attribution, rewards and payouts in PostgreSQL.
   This module is deliberately thin and holds NO creator state:

     GET /api/creator/config   public browser config (Firebase + API base)
     GET /invite/:code         click-recording shell, then store redirect

   Creator sign-in, code management, metrics and earnings all happen
   browser-side against the API with a Firebase ID token — see creator.js.

   Why the click is recorded from the BROWSER and not here: the API's
   POST /api/v1/referrals/click is limited to 5 req/min per IP, and its
   clientIP() deliberately trusts only the rightmost X-Forwarded-For entry
   (the one Cloud Run appends) so it cannot be spoofed. A server-side call
   would therefore put every visitor in one bucket and cap the whole site
   at five clicks a minute. From the browser each visitor gets their own.

   NOTE: the dormant `creators` / `creator_sessions` /
   `creator_referral_clicks` tables in waitlist.db are left in place but
   are no longer read or written. They hold one row from a 2026-10-06
   local test. Safe to drop once nobody needs that record.
   =================================================================== */

const { htmlEscape, renderInvitePage } = require("./referral-pages");
const express = require("express");
const rateLimit = require("express-rate-limit");

const router = express.Router();

// Matches the API's creator-code rule after normalisation. Migration 000111
// dropped the old `cr_` namespace constraint in favour of this.
const CODE_RE = /^[A-Z0-9_]{3,32}$/;

// Public browser configuration. Every value here is already visible in the
// shipped mobile app or in page source; private service credentials stay
// server-side and are never added to this object.
const publicCreatorConfig = {
  apiBase: (process.env.ATTIRA_API_URL || "").replace(/\/+$/, ""),
  webUrl: (process.env.ATTIRA_WEB_URL || process.env.PUBLIC_ORIGIN || "https://attira.org").replace(/\/+$/, ""),
  androidStoreUrl: process.env.ATTIRA_ANDROID_STORE_URL || "https://play.google.com/store/apps/details?id=com.tricore.attira",
  iosStoreUrl: process.env.ATTIRA_IOS_STORE_URL || "https://apps.apple.com/in/app/attira-outfit-planner/id6762454649",
  firebase: {
    apiKey: process.env.FIREBASE_API_KEY || "",
    authDomain: process.env.FIREBASE_AUTH_DOMAIN || "",
    projectId: process.env.FIREBASE_PROJECT_ID || "",
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || "",
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || "",
    appId: process.env.FIREBASE_APP_ID || "",
  },
};

if (process.env.ATTIRA_AUTH_EMULATOR_URL) {
  const emulator = new URL(process.env.ATTIRA_AUTH_EMULATOR_URL);
  if (emulator.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(emulator.hostname)) throw new Error("Auth emulator must be loopback HTTP");
  publicCreatorConfig.authEmulatorUrl = emulator.origin;
}

const inviteLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: "Too many referral requests. Please try again shortly.",
});

function platformFor(userAgent) {
  if (/android/i.test(userAgent)) return "android";
  if (/iphone|ipad|ipod/i.test(userAgent)) return "ios";
  if (userAgent) return "web";
  return "unknown";
}

/* Destination for a platform when no click token is in play — also the
   <noscript> and failure fallback. Attribution is best-effort; the install
   must never be blocked by it. */
function storeUrlFor(platform) {
  if (platform === "android") return publicCreatorConfig.androidStoreUrl;
  if (platform === "ios") return publicCreatorConfig.iosStoreUrl;
  return publicCreatorConfig.webUrl;
}


/* Build the Play Store URL that carries the opaque click token.

   The format is dictated by the app and is exact: its
   services/referral/parseInstallReferrer.ts accepts a SINGLE `click_token`
   key, rejects anything over 512 chars or containing whitespace, and
   interprets no other key — creator codes are never accepted there. So the
   referrer value is `click_token=<TOKEN>` and nothing else. */
function androidReferrerUrl(androidStoreUrl, clickToken) {
  const separator = androidStoreUrl.includes("?") ? "&" : "?";
  return `${androidStoreUrl}${separator}referrer=${encodeURIComponent(`click_token=${clickToken}`)}`;
}

router.get("/api/creator/config", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  return res.json(publicCreatorConfig);
});

// Only explicitly configured app identities are advertised to Apple's CDN.
router.get("/.well-known/apple-app-site-association", (_req, res) => {
  const appIDs = (process.env.ATTIRA_IOS_ASSOCIATED_APP_IDS || "").split(",").map((id) => id.trim()).filter((id) => /^[A-Z0-9]{10}\.[A-Za-z0-9.-]+$/.test(id));
  res.setHeader("Cache-Control", "public, max-age=300");
  res.json({ applinks: { apps: [], details: appIDs.map((id) => ({ appID: id, paths: ["/referral/open"] })) } });
});

// Separate from /invite so opening an installed app never records another click.
router.get("/referral/open", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.send(`<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Open Attira</title><body><h1>Your invitation is ready</h1><p>Install Attira, then return to your original invitation and tap Open Attira.</p><a href="${htmlEscape(publicCreatorConfig.iosStoreUrl)}">Get Attira</a></body></html>`);
});

/* ── GET /invite/:creatorCode ───────────────────────────────────────
   Serves a shell that records the click from the visitor's own browser
   and then forwards to the right store. The code is not validated against
   a local table — the API is the only authority on which codes exist, and
   an unknown code simply yields a plain store redirect. */
router.get("/invite/:creatorCode", inviteLimiter, (req, res) => {
  const creatorCode = String(req.params.creatorCode || "").trim().toUpperCase();
  const platform = platformFor(req.get("user-agent") || "");
  const fallbackUrl = storeUrlFor(platform);

  if (!CODE_RE.test(creatorCode)) {
    return res.redirect(302, publicCreatorConfig.webUrl);
  }

  res.setHeader("Cache-Control", "no-store");
  return res.send(renderInvitePage({ creatorCode, platform, fallbackUrl, publicCreatorConfig, appScheme: process.env.ATTIRA_REFERRAL_APP_SCHEME }));
});

module.exports = {
  router,
  platformFor,
  storeUrlFor,
  androidReferrerUrl,
  publicCreatorConfig,
  CODE_RE,
};
