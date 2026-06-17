// Crop the baked-in OS chrome (status bar / Dynamic Island / device bezel) off the
// feature-section app screenshots so the site can draw ONE uniform Dynamic Island over
// all of them (see .device__screen::after in styles.css).
//
// Always reads the uncropped masters from assets/raw/ and writes the cropped result to
// assets/<same name>, so re-running never compounds crops. Tune the px values below and
// re-run: `node scripts/crop-shots.js`.
const sharp = require("sharp");
const path = require("path");

const RAW = path.join(__dirname, "..", "assets", "raw");
const OUT = path.join(__dirname, "..", "assets");

// crop = px removed from each edge of the master (strips the OS status bar / island / bezel).
// pad  = px of clean band added back on top, filled with the screenshot's own top color, so the
//        uniform CSS Dynamic Island (.device__screen::after) floats over empty space, seamlessly.
const JOBS = [
  { file: "Discover.jpeg", crop: 70,  cropBottom: 0,  pad: 70 },
  { file: "Saved.jpeg",    crop: 70,  cropBottom: 0,  pad: 70 },
  { file: "Profile.jpeg",  crop: 70,  cropBottom: 0,  pad: 70 },
  { file: "Wardrobe.jpeg", crop: 60,  cropBottom: 0,  pad: 90 },
  { file: "Aira.png",      crop: 100, cropBottom: 70, pad: 100 },
];

async function topColor(buf) {
  const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width, ch = info.channels;
  let r = 0, g = 0, b = 0, n = 0;
  for (let y = 0; y < 5; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * ch; r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
  }
  return { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n) };
}

(async () => {
  for (const { file, crop, cropBottom, pad } of JOBS) {
    const src = path.join(RAW, file);
    const meta = await sharp(src).metadata();
    const height = meta.height - crop - cropBottom;
    const cropped = await sharp(src)
      .extract({ left: 0, top: crop, width: meta.width, height })
      .toBuffer();
    const c = await topColor(cropped);
    await sharp(cropped)
      .extend({ top: pad, bottom: 0, left: 0, right: 0, background: { ...c, alpha: 1 } })
      .toFile(path.join(OUT, file));
    console.log(`${file}: ${meta.width}x${meta.height} -> ${meta.width}x${height + pad} (crop ${crop}/${cropBottom}, pad ${pad}, band rgb ${c.r},${c.g},${c.b})`);
  }
  console.log("done");
})().catch((e) => { console.error(e); process.exit(1); });
