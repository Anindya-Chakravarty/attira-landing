#!/usr/bin/env node
/* ===================================================================
   One-time Google consent for the careers → Drive pipeline.

   Run this ONCE, on a machine with a browser, signed in as the account
   that should own the application folder — ootfits3@gmail.com. That is
   deliberately NOT jodmcp@, which owns the GCP project and the OAuth
   client: the client is just an app identity, and any Google account can
   consent to it once the app is published. It prints the
   {client_id, client_secret, refresh_token} blob that Cloud Run reads
   from Secret Manager as DRIVE_OAUTH.

     node scripts/drive-auth.js --client-id=… --client-secret=…
     node scripts/drive-auth.js --from=client_secret_xxx.json

   There is also a shortcut for TESTING, which borrows gcloud's own OAuth
   client instead of making one:

     gcloud auth application-default login \
       --scopes=https://www.googleapis.com/auth/drive.file,openid,email
     node scripts/drive-auth.js --from-adc

   Fine for a first run; use a real client of your own in production, so
   the pipeline doesn't depend on gcloud's client staying as it is.

   The scope is drive.file and only drive.file. See the header of
   careers-drive.js for why: full `drive` is a restricted scope, which
   pins the OAuth app to "Testing" status, where refresh tokens expire
   after 7 days — this pipeline would break every week.
   =================================================================== */

const http = require("http");
const fs = require("fs");
const { OAuth2Client } = require("google-auth-library");

const SCOPE = "https://www.googleapis.com/auth/drive.file";
const PORT = 53682; // loopback redirect, allowed for "Desktop app" clients

function arg(name) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : "";
}

function has(flag) {
  return process.argv.includes(`--${flag}`);
}

/* Shells don't expand ~ inside --from=…, and the file Google hands you
   has a long generated name — so accept the tilde, and fall back to
   "the newest client_secret*.json in Downloads" when the path misses. */
function resolveClientFile(given) {
  const os = require("os");
  const path = require("path");
  const expanded = given.replace(/^~(?=$|[/\\])/, os.homedir());
  if (fs.existsSync(expanded)) return expanded;

  const downloads = path.join(os.homedir(), "Downloads");
  const found = (fs.existsSync(downloads) ? fs.readdirSync(downloads) : [])
    .filter((f) => /^client_secret.*\.json$/.test(f))
    .map((f) => path.join(downloads, f))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];

  if (found) {
    console.log(`(${expanded} not found — using ${found})`);
    return found;
  }
  throw new Error(
    `${expanded} not found, and no client_secret*.json in ~/Downloads.\n` +
    "Create a Desktop-app OAuth client in the attira-website-jod project and download its JSON."
  );
}

function credentials() {
  const from = arg("from");
  if (from) {
    const parsed = JSON.parse(fs.readFileSync(resolveClientFile(from), "utf8"));
    const c = parsed.installed || parsed.web || parsed;
    return { clientId: c.client_id, clientSecret: c.client_secret };
  }
  return {
    clientId: arg("client-id") || process.env.DRIVE_CLIENT_ID,
    clientSecret: arg("client-secret") || process.env.DRIVE_CLIENT_SECRET,
  };
}

/* gcloud's ADC file already holds a user refresh token in exactly the
   shape we need — reuse it rather than repeating the consent dance. */
function fromAdc() {
  const path = require("path");
  const os = require("os");
  const file =
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    path.join(os.homedir(), ".config", "gcloud", "application_default_credentials.json");
  const adc = JSON.parse(fs.readFileSync(file, "utf8"));
  if (adc.type !== "authorized_user" || !adc.refresh_token) {
    throw new Error(
      `${file} is not a user credential. Run:\n` +
      "  gcloud auth application-default login --scopes=https://www.googleapis.com/auth/drive.file,openid,email"
    );
  }
  return {
    client_id: adc.client_id,
    client_secret: adc.client_secret,
    refresh_token: adc.refresh_token,
  };
}

function report(blob) {
  const json = JSON.stringify(blob);
  console.log("\n── DRIVE_OAUTH ─────────────────────────────────────────\n");
  console.log(json);
  console.log("\n── store it ────────────────────────────────────────────\n");
  console.log(
    "printf '%s' '" + json + "' | \\\n" +
    "  gcloud secrets create attira-drive-oauth --project=attira-website-jod --data-file=-\n\n" +
    "(use `gcloud secrets versions add attira-drive-oauth --data-file=-` if it already exists)\n"
  );
  console.log("Then, to test locally:  export DRIVE_OAUTH='<the blob above>'\n");
}

async function main() {
  if (has("from-adc")) {
    report(fromAdc());
    return;
  }

  const { clientId, clientSecret } = credentials();
  if (!clientId || !clientSecret) {
    console.error(
      "Need an OAuth client. Create a Desktop-app client in the attira-website-jod\n" +
      "project, then either:\n" +
      "  node scripts/drive-auth.js --from=client_secret_….json\n" +
      "  node scripts/drive-auth.js --client-id=… --client-secret=…\n"
    );
    process.exit(1);
  }

  const redirectUri = `http://127.0.0.1:${PORT}`;
  const oauth = new OAuth2Client(clientId, clientSecret, redirectUri);
  const url = oauth.generateAuthUrl({
    access_type: "offline",
    prompt: "consent", // force a refresh_token even on a repeat run
    scope: [SCOPE],
  });

  const code = await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const got = new URL(req.url, redirectUri).searchParams.get("code");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(
        got
          ? "<h1>Done</h1><p>Attira careers is connected to Drive. You can close this tab.</p>"
          : "<h1>No code</h1><p>Consent was cancelled — re-run the script.</p>"
      );
      server.close();
      got ? resolve(got) : reject(new Error("consent cancelled"));
    });
    server.listen(PORT, "127.0.0.1", () => {
      console.log("\nOpen this URL, signed in as the account that should OWN the folder:\n");
      console.log(url + "\n");
      console.log(`Waiting for the redirect on ${redirectUri} …`);
    });
    server.on("error", reject);
  });

  const { tokens } = await oauth.getToken(code);
  if (!tokens.refresh_token) {
    console.error(
      "\nGoogle returned no refresh_token. That happens when this client was already\n" +
      "authorised — revoke it at https://myaccount.google.com/permissions and retry."
    );
    process.exit(1);
  }

  report({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: tokens.refresh_token,
  });
}

main().catch((err) => {
  console.error("\nFailed:", err.message);
  process.exit(1);
});
