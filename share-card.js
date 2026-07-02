/* ===================================================================
   Attira — "Share to Story" card generator
   Renders a branded 1080×1920 vertical image entirely client-side (no
   server round-trip) carrying the member's queue position, share code,
   and a scannable QR to their /r/CODE link. This is the unit of
   distribution for Instagram & TikTok, where feed links aren't tappable
   and the existing WhatsApp/X/email buttons are useless — a picture is
   the only thing that travels.

   Sharing path: Web Share API Level 2 (navigator.share with a File) drops
   the PNG straight into the IG/TikTok story composer on mobile. Where
   that's unavailable (most desktops), we fall back to a PNG download.

   Depends on the self-hosted qrcode-generator global (vendor/qrcode.js),
   loaded before this file. Exposes window.AttiraShareCard.
   =================================================================== */
(function () {
  "use strict";

  var W = 1080;
  var H = 1920;

  // Brand palette — mirrors styles.css.
  var CREAM = "#fffce8";
  var ORANGE = "#e04d1b";
  var INK = "#3d3632";
  var PLUM = "#4c1d95";

  // Round-rect path helper (older Safari lacks ctx.roundRect).
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // Draw the QR for `url` as crisp squares centred in a white card.
  function drawQR(ctx, url, cx, top, size) {
    var qr = window.qrcode(0, "M"); // type 0 = auto-size, M = ~15% error correction
    qr.addData(url);
    qr.make();
    var count = qr.getModuleCount();

    var pad = 56;
    var cardSize = size + pad * 2;
    var cardX = cx - cardSize / 2;
    ctx.fillStyle = "#ffffff";
    roundRect(ctx, cardX, top, cardSize, cardSize, 40);
    ctx.fill();

    var cell = size / count;
    var originX = cx - size / 2;
    var originY = top + pad;
    ctx.fillStyle = PLUM;
    for (var r = 0; r < count; r++) {
      for (var c = 0; c < count; c++) {
        if (qr.isDark(r, c)) {
          // +1px overdraw avoids hairline seams between cells.
          ctx.fillRect(
            Math.floor(originX + c * cell),
            Math.floor(originY + r * cell),
            Math.ceil(cell) + 1,
            Math.ceil(cell) + 1
          );
        }
      }
    }
    return top + cardSize;
  }

  function render(stats) {
    var canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    var ctx = canvas.getContext("2d");

    var code = stats.shareCode;
    var pos = stats.position;
    var origin = window.location.origin;
    var shareUrl = origin + "/r/" + code + "?c=ig";

    // Background
    ctx.fillStyle = CREAM;
    ctx.fillRect(0, 0, W, H);

    ctx.textAlign = "center";

    // Wordmark
    ctx.fillStyle = ORANGE;
    ctx.font = '600 64px "Cormorant Garamond", serif';
    ctx.save();
    // letter-spacing isn't supported on older canvas; approximate by spacing.
    if ("letterSpacing" in ctx) ctx.letterSpacing = "18px";
    ctx.fillText("ATTIRA", W / 2, 230);
    ctx.restore();

    // Eyebrow
    ctx.fillStyle = PLUM;
    ctx.font = '500 40px "DM Sans", sans-serif';
    ctx.fillText("MY PLACE ON THE WAITLIST", W / 2, 430);

    // Big position
    ctx.fillStyle = PLUM;
    ctx.font = '600 360px "Cormorant Garamond", serif';
    ctx.fillText(pos ? "#" + Number(pos).toLocaleString() : "—", W / 2, 760);

    // Tagline (two lines)
    ctx.fillStyle = INK;
    ctx.font = '400 50px "DM Sans", sans-serif';
    ctx.fillText("Skip the line with me —", W / 2, 900);
    ctx.fillText("join my link and we both move up.", W / 2, 968);

    // QR
    var qrBottom = drawQR(ctx, shareUrl, W / 2, 1060, 440);

    // Code + CTA under the QR
    ctx.fillStyle = ORANGE;
    ctx.font = '500 46px "DM Sans", sans-serif';
    ctx.fillText("Code " + code, W / 2, qrBottom + 96);

    ctx.fillStyle = INK;
    ctx.font = '400 42px "DM Sans", sans-serif';
    ctx.fillText("Scan it, or join free at attira.org", W / 2, qrBottom + 162);

    // Footer handle
    ctx.fillStyle = PLUM;
    ctx.font = '500 40px "DM Sans", sans-serif';
    ctx.fillText("@attira.closet", W / 2, H - 56);

    return canvas;
  }

  function canvasToBlob(canvas) {
    return new Promise(function (resolve) {
      if (canvas.toBlob) canvas.toBlob(resolve, "image/png");
      else {
        // Legacy fallback via data URL.
        var data = canvas.toDataURL("image/png");
        var bin = atob(data.split(",")[1]);
        var arr = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        resolve(new Blob([arr], { type: "image/png" }));
      }
    });
  }

  // Make sure the brand webfonts are loaded before we paint, else the card
  // falls back to a system font and looks off-brand.
  function fontsReady() {
    if (!document.fonts || !document.fonts.load) return Promise.resolve();
    return Promise.all([
      document.fonts.load('600 360px "Cormorant Garamond"'),
      document.fonts.load('500 40px "DM Sans"'),
      document.fonts.load('400 44px "DM Sans"'),
    ]).catch(function () {});
  }

  /* Generate + share (or download) the card. Returns a promise resolving to
     { method: "shared" | "downloaded" } so callers can tailor the message.
     `onEvent(method)` is an optional analytics hook. */
  function share(stats, onEvent) {
    if (!window.qrcode) return Promise.reject(new Error("qr lib missing"));
    return fontsReady()
      .then(function () { return canvasToBlob(render(stats)); })
      .then(function (blob) {
        var file = new File([blob], "attira-waitlist-" + stats.shareCode + ".png", {
          type: "image/png",
        });
        var canShareFiles =
          navigator.canShare && navigator.canShare({ files: [file] });
        if (canShareFiles && navigator.share) {
          return navigator
            .share({
              files: [file],
              title: "My Attira waitlist spot",
              text: "I'm on the Attira waitlist — join my link and we both skip ahead.",
            })
            .then(function () {
              if (onEvent) onEvent("shared");
              return { method: "shared" };
            })
            .catch(function (err) {
              // User cancelled the share sheet — not an error worth surfacing.
              if (err && err.name === "AbortError") return { method: "cancelled" };
              return downloadBlob(blob, file.name, onEvent);
            });
        }
        return downloadBlob(blob, file.name, onEvent);
      });
  }

  function downloadBlob(blob, name, onEvent) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    if (onEvent) onEvent("downloaded");
    return { method: "downloaded" };
  }

  window.AttiraShareCard = { share: share, render: render };
})();
