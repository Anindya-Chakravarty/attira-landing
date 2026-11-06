import test from "node:test";
import assert from "node:assert/strict";
import worker from "./referral-worker.mjs";

const origin = "https://attira.org";
test("production association advertises the real app and installed-link path", async () => {
  const r = await worker.fetch(new Request(origin + "/.well-known/apple-app-site-association"), {});
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("Content-Type"), "application/json");
  assert.deepEqual((await r.json()).applinks.details, [{ appID: "Q8XGJP48AR.com.outfits.attira", paths: ["/referral/open"] }]);
});
test("friend and creator codes use the shared renderer and production API", async () => {
  for (const code of ["FRIEND01", "CREATOR_01"]) {
    const r = await worker.fetch(new Request(origin + "/invite/" + code, { headers: { "User-Agent": "iPhone" } }), {});
    const body = await r.text();
    assert.equal(r.status, 200);
    assert.ok(body.includes(`data-code="${code}"`));
    assert.ok(body.includes('data-api-base="https://api.attira.org"'));
    assert.ok(body.includes('data-app-scheme="attira"'));
    assert.ok(body.includes('/invite.js?v=1'));
    assert.ok(body.includes("6762454649"));
    assert.equal(r.headers.get("Referrer-Policy"), "no-referrer");
  }
});
test("invalid input cannot inject HTML and other website paths are not served", async () => {
  const invalid = await worker.fetch(new Request(origin + "/invite/%3Cscript%3E"), {});
  assert.equal(invalid.status, 302);
  assert.equal(invalid.headers.get("Location"), origin);
  for (const path of ["/", "/careers", "/api/waitlist"]) {
    assert.equal((await worker.fetch(new Request(origin + path), {})).status, 404);
  }
  assert.equal((await worker.fetch(new Request(origin + "/invite/FRIEND01", { method: "POST" }), {})).status, 405);
});
test("serves only the existing invitation script asset and supports HEAD", async () => {
  let calls = 0;
  const env = { ASSETS: { fetch: async (request) => { calls++; assert.equal(new URL(request.url).pathname, "/invite.js"); return new Response("script", { headers: { "Content-Type": "text/javascript" } }); } } };
  assert.equal(await (await worker.fetch(new Request(origin + "/invite.js?v=1"), env)).text(), "script");
  assert.equal(calls, 1);
  const head = await worker.fetch(new Request(origin + "/invite/FRIEND01", { method: "HEAD" }), env);
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
});
