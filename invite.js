/* ===================================================================
   /invite/:code — record the referral click, then send the visitor on.

   Runs in the visitor's own browser on purpose: the API limits
   POST /api/v1/referrals/click to 5/min per IP and trusts only the
   rightmost X-Forwarded-For entry, so recording this server-side would
   cap the entire site at five clicks a minute.

   The guiding rule is that attribution is best-effort and the install is
   not: every failure path still forwards to the store.
   =================================================================== */
(function () {
  "use strict";

  var root = document.getElementById("inviteRoot");
  if (!root) return;

  var code = root.getAttribute("data-code") || "";
  var apiBase = root.getAttribute("data-api-base") || "";
  var androidUrl = root.getAttribute("data-android-url") || "";
  var fallbackUrl = root.getAttribute("data-fallback-url") || "/";
  var serverPlatform = root.getAttribute("data-platform") || "unknown";

  // The API's referral_clicks.platform has a CHECK constraint and the handler
  // does not validate the value, so anything outside this set becomes a 500.
  function detectPlatform() {
    var ua = navigator.userAgent || "";
    if (/android/i.test(ua)) return "android";
    if (/iphone|ipad|ipod/i.test(ua)) return "ios";
    // iPadOS 13+ reports a desktop UA; maxTouchPoints is the usual tell.
    if (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) return "ios";
    if (ua) return "web";
    return "unknown";
  }

  var platform = detectPlatform();
  if (platform === "unknown" && serverPlatform !== "unknown") platform = serverPlatform;
  var openButton = document.getElementById("inviteOpen");
  var installButton = document.getElementById("inviteInstall");
  var statusText = document.getElementById("inviteStatus");
  var storageKey = "attira.invite." + code;
  function ready(token) {
    if (installButton) installButton.href = destinationFor(token);
    if (openButton && token) {
      var scheme = root.getAttribute("data-app-scheme") || "attira";
      if (!/^[a-z][a-z0-9-]*$/.test(scheme)) scheme = "attira";
      openButton.href = scheme + "://referral/open?click_token=" + encodeURIComponent(token);
      openButton.hidden = false;
    }
    if (statusText) statusText.textContent = token ? "Your invitation is ready. Open Attira after installing." : "You can enter the code in Attira after signing up.";
  }

  function leave(url) {
    window.location.replace(url);
  }

  // Attribution only has somewhere to go on Android, where the Play Store
  // hands the referrer string to the app's install-referrer module. iOS has
  // no equivalent, so those users fall back to entering the code in-app.
  function destinationFor(clickToken) {
    if (!clickToken || platform !== "android" || !androidUrl) return fallbackUrl;
    var separator = androidUrl.indexOf("?") === -1 ? "?" : "&";
    return androidUrl + separator + "referrer=" + encodeURIComponent("click_token=" + clickToken);
  }

  if (!apiBase || !code) {
    ready(null);
    return;
  }

  // Don't strand the visitor if the API is slow or unreachable.
  var done = false;
  function finish(url) {
    if (done) return;
    done = true;
    if (platform === "android") leave(url);
    else ready(null);
  }
  var timer = window.setTimeout(function () { finish(fallbackUrl); }, 3500);

  var controller = typeof AbortController === "function" ? new AbortController() : null;
  try {
    var cached = JSON.parse(sessionStorage.getItem(storageKey) || "null");
    if (cached && cached.token && Date.now() - cached.at < 30 * 60 * 1000) {
      window.clearTimeout(timer);
      ready(cached.token);
      return;
    }
  } catch (_) { /* Storage is optional. */ }

  // Deliberately no X-Request-ID: it is absent from the API's CORS
  // AllowedHeaders, so sending it fails the preflight.
  fetch(apiBase + "/api/v1/referrals/click", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // The API decoder uses DisallowUnknownFields — these two keys exactly.
    body: JSON.stringify({ referral_code: code, platform: platform }),
    signal: controller ? controller.signal : undefined,
  })
    .then(function (response) {
      if (response.status !== 201) return null;
      return response.json().catch(function () { return null; });
    })
    .then(function (body) {
      var token = body && body.data && body.data.click_token;
      window.clearTimeout(timer);
      if (done) return;
      done = true;
      if (token) { try { sessionStorage.setItem(storageKey, JSON.stringify({ token: token, at: Date.now() })); } catch (_) {} }
      if (platform === "android") leave(destinationFor(token));
      else ready(token);
    })
    .catch(function () {
      window.clearTimeout(timer);
      finish(fallbackUrl);
    });
})();
