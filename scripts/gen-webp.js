/* ===================================================================
   One-off asset optimiser — generates .webp next to the source PNGs.
   Run:  npm run gen-webp   (re-run whenever the source PNGs change)

   WebP is served via <picture> in the HTML with the PNG kept as the
   <img> fallback, so this script is purely additive — it never deletes
   or overwrites the original PNGs.
   =================================================================== */

const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const ASSETS = path.join(__dirname, "..", "assets");

// Source PNGs to convert to WebP (same basename, .webp extension).
const IMAGES = [
  "hero-phones.png",
  "hero-phone.png",
  "about-rack.png",
  "content-discover.png",
  "content-wardrobe.png",
  "content-aira.png",
  "content-saved.png",
  "content-account.png",
];

async function toWebp(file) {
  const src = path.join(ASSETS, file);
  if (!fs.existsSync(src)) {
    console.warn(`  skip (missing): ${file}`);
    return;
  }
  const out = path.join(ASSETS, file.replace(/\.png$/i, ".webp"));
  const before = fs.statSync(src).size;
  await sharp(src).webp({ quality: 80, effort: 5 }).toFile(out);
  const after = fs.statSync(out).size;
  const pct = Math.round((1 - after / before) * 100);
  console.log(
    `  ${file} → ${path.basename(out)}  ${(before / 1024).toFixed(0)}KB → ${(after / 1024).toFixed(0)}KB (-${pct}%)`
  );
}

async function makeOgImage() {
  // Social share image: 1200×630, derived from the hero render on the
  // site's cream background so link previews look on-brand.
  const src = path.join(ASSETS, "hero-phones.png");
  if (!fs.existsSync(src)) return;
  const out = path.join(ASSETS, "og-image.png");
  await sharp(src)
    .resize(1200, 630, { fit: "contain", background: "#fffce8" })
    .flatten({ background: "#fffce8" })
    .png()
    .toFile(out);
  console.log(`  og-image.png written (1200×630)`);
}

(async () => {
  console.log("Generating WebP assets…");
  for (const file of IMAGES) {
    try {
      await toWebp(file);
    } catch (err) {
      console.error(`  failed: ${file}`, err.message);
    }
  }
  try {
    await makeOgImage();
  } catch (err) {
    console.error("  og-image failed:", err.message);
  }
  console.log("Done.");
})();
