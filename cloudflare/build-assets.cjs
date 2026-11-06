const fs = require("node:fs");
const path = require("node:path");
fs.mkdirSync(path.join(__dirname, "assets"), { recursive: true });
fs.copyFileSync(path.join(__dirname, "..", "invite.js"), path.join(__dirname, "assets", "invite.js"));
