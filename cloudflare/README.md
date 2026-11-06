# Isolated production referral links

This Worker serves only the production invitation, invitation JavaScript,
installed-app landing and Apple app-association routes. It shares the existing
Express invitation renderer and ships the existing `invite.js` without changes.
The Go API remains the authority for clicks, claims, eligibility and rewards.
There is no database, Firebase credential, service-account key or server-side
claim in this Worker. Request invocation logs are disabled to avoid capturing
invitation handoff query tokens.

Use this deployment instead of restarting the production website during the
referral rollout. The existing Cloud Run website has two local SQLite databases
replicated through Litestream, both revision minimum and maximum one instance.
An overlapping new revision is not a verified sole-writer handoff. These narrow
edge routes avoid that handoff and leave waitlist/careers storage untouched.

From the repository root:

```sh
npm test
npx --yes wrangler@4.158.0 deploy --config cloudflare/wrangler.jsonc --dry-run
```

Before publishing, restore Cloudflare sign-in (`wrangler login`), verify the
account owns `attira.org`, export its existing Worker routes and active website
proxy version, and confirm none of the four narrow patterns belongs to another
purpose. Save those receipts privately. The Worker adds more-specific paths; it
does not replace or edit the existing catch-all website proxy. Match exact
reviewed-main source, then deploy this config. Do not deploy `server.js` or the
website Docker image as part of this step.

Verify public AASA JSON advertises `Q8XGJP48AR.com.outfits.attira` and
`/referral/open`, invitation HTML uses `https://api.attira.org`, script bytes
match `invite.js`, and root/careers/waitlist/creator controls retain their prior
responses. Confirm the browser click and physical-device handoff separately.
The app archive/upload readiness script is an additional required check.

Rollback removes only the four newly recorded route bindings, restoring the
previous website proxy for those paths. Retain the Worker version/source receipt.
It does not undo any API reward or PostgreSQL migration. Existing Apple CDN
caching may delay installed-link verification; test it on a physical device.
