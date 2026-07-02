/* ===================================================================
   Attira — dynamic Open Graph share cards
   Renders a per-referrer 1200×630 PNG used as the link-unfurl image when
   someone shares their /r/ATR-XXXXX link in WhatsApp, iMessage, X, etc.
   The card shows their queue position + code so the preview is personal
   ("Aira is #42 — join and you both skip ahead") instead of the generic
   homepage image.

   Pipeline: satori (HTML/CSS-ish element tree → SVG, pure JS) →
   @resvg/resvg-js (SVG → PNG, prebuilt binary). Both avoid the native
   `canvas` build, so the existing Node-slim Docker image needs no extra
   system libraries. Rendered cards are cached in-process per code.
   =================================================================== */

const fs = require("fs");
const path = require("path");

const FONT_DIR = path.join(__dirname, "assets", "fonts");
const WIDTH = 1200;
const HEIGHT = 630;

// Brand palette (mirrors styles.css :root).
const CREAM = "#fffce8";
const ORANGE = "#e04d1b";
const INK = "#3d3632";
const PLUM = "#4c1d95";

// Lazily-loaded singletons so the (synchronous, blocking) font reads and the
// satori/resvg requires happen on first use, not at server boot.
let _fonts = null;
let _satori = null;
let _Resvg = null;
const _cache = new Map(); // code → PNG Buffer

function loadFonts() {
  if (_fonts) return _fonts;
  const read = (file) => fs.readFileSync(path.join(FONT_DIR, file));
  // Static instances (pinned weights). satori's bundled opentype parser
  // chokes on these families' variable fvar tables, so we ship fixed cuts.
  _fonts = [
    { name: "Cormorant Garamond", data: read("CormorantGaramond-SemiBold.ttf"), weight: 600, style: "normal" },
    { name: "DM Sans", data: read("DMSans-Regular.ttf"), weight: 400, style: "normal" },
    { name: "DM Sans", data: read("DMSans-Medium.ttf"), weight: 500, style: "normal" },
  ];
  return _fonts;
}

// Tiny helper to keep the element tree readable without JSX.
function el(type, props, children) {
  return { type, props: { ...(props || {}), children: children == null ? props && props.children : children } };
}

function cardTree({ position, code, referralCount }) {
  const posText = position ? `#${Number(position).toLocaleString()}` : "—";
  const refLine =
    referralCount > 0
      ? `${referralCount} friend${referralCount === 1 ? "" : "s"} already joined through them`
      : "Join with their link and you both skip ahead";

  return el(
    "div",
    {
      style: {
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        backgroundColor: CREAM,
        padding: "64px 72px",
        fontFamily: "DM Sans",
        color: INK,
      },
    },
    [
      // Wordmark
      el("div", {
        style: {
          fontFamily: "Cormorant Garamond",
          fontSize: 44,
          fontWeight: 600,
          letterSpacing: "0.32em",
          textTransform: "uppercase",
          color: ORANGE,
        },
        children: "ATTIRA",
      }),
      // Centre block
      el(
        "div",
        { style: { display: "flex", flexDirection: "column" } },
        [
          el("div", {
            style: { fontSize: 30, fontWeight: 500, color: PLUM, marginBottom: 8 },
            children: "Their place on the waitlist",
          }),
          el("div", {
            style: {
              fontFamily: "Cormorant Garamond",
              fontSize: 200,
              fontWeight: 600,
              lineHeight: 1,
              color: PLUM,
            },
            children: posText,
          }),
          el("div", {
            style: { fontSize: 34, color: INK, marginTop: 16, maxWidth: 980 },
            children: refLine,
          }),
        ]
      ),
      // Footer row: code + CTA
      el(
        "div",
        { style: { display: "flex", justifyContent: "space-between", alignItems: "flex-end" } },
        [
          el("div", {
            style: {
              fontSize: 30,
              fontWeight: 500,
              letterSpacing: "0.08em",
              color: ORANGE,
            },
            children: `Code ${code}`,
          }),
          el("div", {
            style: { fontSize: 30, fontWeight: 500, color: INK },
            children: "Join free → attira.org",
          }),
        ]
      ),
    ]
  );
}

/* Render (and cache) the OG PNG for one share code. Returns a Buffer.
   Throws if fonts/libs are unavailable — callers should fall back to the
   static og-image.png so a render failure never breaks the unfurl. */
async function renderCard({ code, position, referralCount }) {
  if (_cache.has(code)) return _cache.get(code);

  if (!_satori) _satori = require("satori").default || require("satori");
  if (!_Resvg) _Resvg = require("@resvg/resvg-js").Resvg;

  const svg = await _satori(cardTree({ position, code, referralCount }), {
    width: WIDTH,
    height: HEIGHT,
    fonts: loadFonts(),
  });
  const png = new _Resvg(svg, { fitTo: { mode: "width", value: WIDTH } })
    .render()
    .asPng();

  // Bound the cache so a flood of distinct codes can't grow it unbounded.
  if (_cache.size > 5000) _cache.clear();
  _cache.set(code, png);
  return png;
}

module.exports = { renderCard, WIDTH, HEIGHT };
