/* Tests for the website tier of the creator referral program.

   Scope note: creator identity, codes, metrics and earnings live in the Go
   API, so there is nothing local to test for them. What the website still
   owns — and what breaks silently if it regresses — is the /invite shell and
   the exact Play Store referrer encoding the mobile app parses. Those are
   what this file covers.

   Run: npm test
*/
const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const vm = require("node:vm");
const fs = require("node:fs");

process.env.ATTIRA_API_URL = "https://dev-api.attira.org";
process.env.ATTIRA_WEB_URL = "https://attira.org";
process.env.ATTIRA_ANDROID_STORE_URL = "https://play.google.com/store/apps/details?id=com.tricore.attira";
process.env.ATTIRA_IOS_STORE_URL = "https://apps.apple.com/in/app/attira-outfit-planner/id6762454649";
process.env.FIREBASE_API_KEY = "test-api-key";
process.env.FIREBASE_AUTH_DOMAIN = "ootfits-dev-jod.firebaseapp.com";
process.env.FIREBASE_PROJECT_ID = "ootfits-dev-jod";
process.env.ATTIRA_IOS_ASSOCIATED_APP_IDS = "Q8XGJP48AR.com.ootfits.app";

const creatorProgram = require("./creator-program");

const ANDROID_UA = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36";
const IOS_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15";
const DESKTOP_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

/* Mirror of the app's services/referral/parseInstallReferrer.ts so a change
   to our encoding that the app could not read fails here instead of silently
   producing unattributed installs. */
function parseOpaqueClickToken(rawReferrer) {
  if (!rawReferrer || rawReferrer.length > 4096) return null;
  let params;
  try {
    params = new URLSearchParams(rawReferrer.replace(/^\?/, ""));
  } catch {
    return null;
  }
  const values = params.getAll("click_token");
  if (values.length !== 1) return null;
  const clickToken = values[0].trim();
  if (!clickToken || clickToken.length > 512 || /\s/.test(clickToken)) return null;
  return { clickToken };
}

function startServer() {
  const app = express();
  app.use(creatorProgram.router);
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve({ server, port: server.address().port }));
  });
}

test("platformFor maps every user-agent class the API accepts", () => {
  assert.equal(creatorProgram.platformFor(ANDROID_UA), "android");
  assert.equal(creatorProgram.platformFor(IOS_UA), "ios");
  assert.equal(creatorProgram.platformFor("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)"), "ios");
  assert.equal(creatorProgram.platformFor(DESKTOP_UA), "web");
  assert.equal(creatorProgram.platformFor(""), "unknown");

  // referral_clicks.platform has a CHECK constraint and the handler does not
  // validate, so an out-of-set value would surface as a 500.
  for (const ua of [ANDROID_UA, IOS_UA, DESKTOP_UA, ""]) {
    assert.ok(["android", "ios", "web", "unknown"].includes(creatorProgram.platformFor(ua)));
  }
});

test("storeUrlFor sends each platform to the right destination", () => {
  assert.equal(creatorProgram.storeUrlFor("android"), process.env.ATTIRA_ANDROID_STORE_URL);
  assert.equal(creatorProgram.storeUrlFor("ios"), process.env.ATTIRA_IOS_STORE_URL);
  assert.equal(creatorProgram.storeUrlFor("web"), process.env.ATTIRA_WEB_URL);
  assert.equal(creatorProgram.storeUrlFor("unknown"), process.env.ATTIRA_WEB_URL);
});

test("android referrer carries exactly one click_token the app can parse", () => {
  // 43-char base64url, the real shape of referral.NewToken()
  const token = "Xy7-_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKL";
  assert.equal(token.length, 43);

  const url = creatorProgram.androidReferrerUrl(process.env.ATTIRA_ANDROID_STORE_URL, token);
  const referrer = new URL(url).searchParams.get("referrer");

  assert.equal(referrer, `click_token=${token}`);
  assert.deepEqual(parseOpaqueClickToken(referrer), { clickToken: token });

  // The app rejects a referrer carrying anything but a single click_token,
  // so the encoding must not grow extra keys.
  assert.equal(new URLSearchParams(referrer).getAll("click_token").length, 1);
  assert.deepEqual([...new URLSearchParams(referrer).keys()], ["click_token"]);
});

test("android referrer is appended, not substituted, when the URL has a query", () => {
  const url = creatorProgram.androidReferrerUrl("https://play.google.com/store/apps/details?id=com.tricore.attira", "tok");
  assert.equal(new URL(url).searchParams.get("id"), "com.tricore.attira");
  assert.equal(new URL(url).searchParams.get("referrer"), "click_token=tok");
});

test("CODE_RE matches the API rule after migration 000111 dropped the cr_ prefix", () => {
  for (const good of ["ABC", "ANINDYA", "A_B_C", "ABCDEFGHIJ1234567890123456789012"]) {
    assert.ok(creatorProgram.CODE_RE.test(good), `${good} should be valid`);
  }
  for (const bad of ["AB", "a".repeat(33), "has space", "LOWERcase", "dash-code", "cr_ABC12345"]) {
    assert.ok(!creatorProgram.CODE_RE.test(bad), `${bad} should be rejected`);
  }
});

test("GET /invite/:code renders a shell carrying the data the browser needs", async () => {
  const { server, port } = await startServer();
  try {
    const response = await fetch(`http://127.0.0.1:${port}/invite/testcode`, {
      headers: { "user-agent": ANDROID_UA },
      redirect: "manual",
    });
    assert.equal(response.status, 200);
    const body = await response.text();

    assert.match(body, /data-code="TESTCODE"/, "code is normalised to upper case");
    assert.match(body, /data-platform="android"/);
    assert.match(body, /data-api-base="https:\/\/dev-api\.attira\.org"/);
    assert.match(body, /<meta name="robots" content="noindex, nofollow"/);
    assert.match(body, /<script src="\/invite\.js/);
    // Attribution is best-effort; a no-JS visitor must still reach the store.
    assert.match(body, /<noscript>.*play\.google\.com.*<\/noscript>/s);
    assert.equal(response.headers.get("cache-control"), "no-store");
  } finally {
    server.close();
  }
});

test("GET /invite/:code refuses a malformed code without calling the API", async () => {
  const { server, port } = await startServer();
  try {
    for (const bad of ["ab", "bad-code", "with%20space"]) {
      const response = await fetch(`http://127.0.0.1:${port}/invite/${bad}`, { redirect: "manual" });
      assert.equal(response.status, 302, `${bad} should redirect`);
      assert.equal(response.headers.get("location"), process.env.ATTIRA_WEB_URL);
    }
  } finally {
    server.close();
  }
});

test("GET /api/creator/config exposes only public values", async () => {
  const { server, port } = await startServer();
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/creator/config`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const body = await response.json();

    assert.equal(body.apiBase, "https://dev-api.attira.org");
    assert.equal(body.firebase.projectId, "ootfits-dev-jod");

    // A Firebase web apiKey is a public client identifier, but nothing that
    // authenticates this server may ever appear here.
    const serialised = JSON.stringify(body);
    for (const secret of ["ADMIN_KEY", "IP_HASH_SALT", "REFERRAL_TOKEN_HMAC_SECRET", "ATTIRA_CREATOR_PROVISIONING_SECRET", "password_hash"]) {
      assert.ok(!serialised.includes(secret), `${secret} must not be exposed`);
    }
    assert.deepEqual(Object.keys(body).sort(), ["androidStoreUrl", "apiBase", "firebase", "iosStoreUrl", "webUrl"]);
  } finally {
    server.close();
  }
});

test("Apple association advertises only configured identities and the handoff path", async () => {
  const { server, port } = await startServer();
  try {
    const response = await fetch(`http://127.0.0.1:${port}/.well-known/apple-app-site-association`);
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).applinks.details, [{ appID: "Q8XGJP48AR.com.ootfits.app", paths: ["/referral/open"] }]);
  } finally { server.close(); }
});

test("iOS invite keeps the page available and opens the app with the original click token", async () => {
  const token = "T".repeat(43);
  const elements = {
    inviteRoot: { getAttribute: (name) => ({ "data-code": "CREATOR1", "data-api-base": "https://api.example.test", "data-fallback-url": "https://apps.apple.com/app/test", "data-app-scheme": "attira-referral-test" }[name] || "") },
    inviteOpen: { hidden: true }, inviteInstall: {}, inviteStatus: {},
  };
  let calls = 0;
  const redirects = [];
  const storage = new Map();
  const context = {
    document: { getElementById: (id) => elements[id] }, navigator: { userAgent: IOS_UA },
    sessionStorage: { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    window: { location: { origin: "https://invite.example.test", replace: (url) => redirects.push(url) }, setTimeout: () => 1, clearTimeout: () => {} },
    fetch: async () => { calls++; return { status: 201, json: async () => ({ data: { click_token: token } }) }; },
    URLSearchParams,
  };
  vm.runInNewContext(fs.readFileSync(require.resolve("./invite.js"), "utf8"), context);
  await new Promise(setImmediate);
  assert.equal(calls, 1);
  assert.deepEqual(redirects, []);
  assert.equal(elements.inviteOpen.hidden, false);
  assert.equal(elements.inviteOpen.href, `attira-referral-test://referral/open?click_token=${token}`);
  // Returning from the store uses the original evidence instead of a new click.
  vm.runInNewContext(fs.readFileSync(require.resolve("./invite.js"), "utf8"), context);
  await new Promise(setImmediate);
  assert.equal(calls, 1);
});
