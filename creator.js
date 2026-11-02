/* ===================================================================
   Attira creator dashboard — a browser client of the Attira API.

   Identity is Firebase; everything else lives in PostgreSQL behind
   api.attira.org. This file holds no creator state of its own.

     POST /api/v1/referrals/creator/auth/signup   {display_name, referral_code?}
     GET  /api/v1/referrals/creator/auth/profile
     PUT  /api/v1/referrals/creator/auth/code     {referral_code}
     GET  /api/v1/referrals/creator/auth/metrics  ?period=all|current_week|previous_week
     GET  /api/v1/referrals/creator/auth/earnings

   Two API conventions to respect:
     - every response is wrapped as {success, data} — unwrap .data
     - errors arrive as {success:false, error, code}
   =================================================================== */
(function () {
  "use strict";

  var CODE_RE = /^[A-Z0-9_]{3,32}$/;
  var PERIOD_LABELS = { all: "All time", current_week: "This week", previous_week: "Last week" };

  var views = {
    landing: document.getElementById("landingView"),
    auth: document.getElementById("authView"),
    onboard: document.getElementById("onboardView"),
    dashboard: document.getElementById("dashboardView"),
  };

  var toast = document.getElementById("toast");
  var toastTimer;
  var config = null;
  var auth = null;
  var creator = null;
  var currentPeriod = "all";
  var authMode = "signin";

  function byId(id) { return document.getElementById(id); }

  function showView(name) {
    Object.keys(views).forEach(function (key) {
      if (views[key]) views[key].hidden = key !== name;
    });
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  function showToast(message) {
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("is-visible");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () { toast.classList.remove("is-visible"); }, 2600);
  }

  function setError(el, message) {
    if (!el) return;
    el.textContent = message || "";
    el.hidden = !message;
  }

  function capture(event, properties) {
    try {
      if (window.posthog && typeof window.posthog.capture === "function") {
        window.posthog.capture(event, properties || {});
      }
    } catch (_) { /* analytics must never break the page */ }
  }

  /* ── API ──────────────────────────────────────────────────────────
     Sends the Firebase ID token and retries once with a forced refresh
     on 401, so an expired token recovers silently instead of bouncing
     the creator back to sign-in. Deliberately sends no X-Request-ID:
     it is absent from the API's CORS AllowedHeaders. */
  async function api(path, options, retried) {
    options = options || {};
    var user = auth && auth.currentUser;
    if (!user) throw new Error("Please sign in again.");

    var token = await user.getIdToken(Boolean(retried));
    var headers = { Authorization: "Bearer " + token };
    if (options.body) headers["Content-Type"] = "application/json";

    var response = await fetch(config.apiBase + "/api/v1" + path, {
      method: options.method || "GET",
      headers: headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    if (response.status === 401 && !retried) return api(path, options, true);

    var payload = await response.json().catch(function () { return null; });
    if (!response.ok) {
      var error = new Error((payload && payload.error) || "Something went wrong. Please try again.");
      error.status = response.status;
      error.code = payload && payload.code;
      throw error;
    }
    return payload ? payload.data : null;
  }

  /* ── Formatting ───────────────────────────────────────────────── */

  var money = null;
  function formatMinor(amountMinor, currency) {
    var value = (Number(amountMinor) || 0) / 100;
    try {
      if (!money) {
        money = new Intl.NumberFormat("en-IN", {
          style: "currency",
          currency: currency || "INR",
          maximumFractionDigits: 2,
        });
      }
      return money.format(value);
    } catch (_) {
      return (currency || "INR") + " " + value.toFixed(2);
    }
  }

  // The API returns rates as fractions and sends 0 when the denominator is
  // zero. Showing "0%" with no upstream traffic reads as a failure rather
  // than an absence, so the rate is omitted until there is something to
  // divide by.
  function setRate(el, rate, upstreamCount, label) {
    if (!el) return;
    if (!upstreamCount) {
      el.textContent = "";
      el.removeAttribute("title");
      return;
    }
    el.textContent = (Number(rate) * 100).toFixed(1) + "%";
    el.title = label;
  }

  function referralLinkFor(code) {
    return window.location.origin + "/invite/" + code;
  }

  /* ── Dashboard rendering ──────────────────────────────────────── */

  function renderProfile() {
    byId("creatorName").textContent = creator.display_name || "Creator";
    byId("referralLink").textContent = referralLinkFor(creator.referral_code);
    byId("codeInput").value = creator.referral_code || "";
  }

  async function loadMetrics() {
    setError(byId("metricsError"), "");
    var updated = byId("metricsUpdatedAt");
    if (updated) updated.textContent = "Updating…";
    try {
      var m = await api("/referrals/creator/auth/metrics?period=" + encodeURIComponent(currentPeriod));
      byId("metricClicks").textContent = m.clicks;
      byId("metricInstalls").textContent = m.installs;
      byId("metricAttributed").textContent = m.attributed;
      byId("metricActivated").textContent = m.activated;
      byId("metricRetained").textContent = m.retained;

      var rates = m.conversion_rates || {};
      setRate(byId("rateClickInstall"), rates.click_to_install, m.clicks, "of clicks");
      setRate(byId("rateInstallAttributed"), rates.install_to_attributed, m.installs, "of installs");
      setRate(byId("rateAttributedActivated"), rates.attributed_to_activated, m.attributed, "of attributed");
      setRate(byId("rateAttributedRetained"), rates.attributed_to_retained, m.attributed, "of attributed");
      if (updated) updated.textContent = "Updated " + new Date().toLocaleTimeString();
    } catch (error) {
      setError(byId("metricsError"), error.message);
      if (updated) updated.textContent = "Refresh failed; showing the previous values.";
    }
  }

  async function loadEarnings() {
    setError(byId("earningsError"), "");
    try {
      var e = await api("/referrals/creator/auth/earnings");
      var currency = e.currency || "INR";
      byId("earningsCurrency").textContent = currency;
      byId("earningLifetime").textContent = formatMinor(e.lifetime && e.lifetime.amount_minor, currency);
      byId("earningCurrent").textContent = formatMinor(e.current_week && e.current_week.amount_minor, currency);
      byId("earningPayable").textContent = formatMinor(e.payable_payout_amount_minor, currency);
      byId("earningUnbatched").textContent = formatMinor(e.unbatched_eligible_amount_minor, currency);
      // payout_id and state are null until a batch exists — render nothing
      // rather than the string "null".
      var state = e.current_week && e.current_week.state;
      byId("earningCurrentState").textContent = state ? String(state).replace(/_/g, " ") : "";
    } catch (error) {
      setError(byId("earningsError"), error.message);
    }
  }

  function openDashboard() {
    renderProfile();
    showView("dashboard");
    loadMetrics();
    loadEarnings();
  }

  var refreshing = false;
  async function refreshDashboard() {
    if (refreshing || !creator || views.dashboard.hidden) return;
    refreshing = true;
    try { await Promise.all([loadMetrics(), loadEarnings()]); }
    finally { refreshing = false; }
  }
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) refreshDashboard();
  });
  window.addEventListener("focus", refreshDashboard);
  document.addEventListener("DOMContentLoaded", function () {
    var controls = document.createElement("div");
    var refresh = document.createElement("button");
    refresh.type = "button";
    refresh.className = "button button--ghost";
    refresh.textContent = "Refresh metrics";
    refresh.addEventListener("click", refreshDashboard);
    controls.appendChild(refresh);
    var updated = document.createElement("span");
    updated.id = "metricsUpdatedAt";
    updated.setAttribute("role", "status");
    updated.textContent = "Metrics have not loaded yet.";
    controls.appendChild(updated);
    if (views.dashboard) views.dashboard.appendChild(controls);
  });

  /* ── Auth flow ────────────────────────────────────────────────── */

  function friendlyAuthError(error) {
    var code = (error && error.code) || "";
    if (code === "auth/unauthorized-domain") {
      return "This domain isn’t authorised for sign-in yet. Add it in Firebase Authentication → Settings → Authorized domains.";
    }
    if (code === "auth/popup-blocked") return "Your browser blocked the sign-in popup. Allow popups and try again.";
    if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") return "";
    if (code === "auth/invalid-credential" || code === "auth/wrong-password" || code === "auth/user-not-found") {
      return "That email and password don’t match an Attira account.";
    }
    if (code === "auth/email-already-in-use") return "That email already has an Attira account — sign in instead.";
    if (code === "auth/weak-password") return "Choose a password of at least 6 characters.";
    if (code === "auth/network-request-failed") return "Network error. Check your connection and try again.";
    return (error && error.message) || "Sign-in failed. Please try again.";
  }

  // Signup is idempotent per Firebase UID, so a returning creator resolves
  // through /profile and only a genuinely new one sees the onboarding step.
  async function resolveCreator() {
    try {
      creator = await api("/referrals/creator/auth/profile");
      openDashboard();
    } catch (error) {
      if (error.status === 404) {
        var user = auth.currentUser;
        byId("onboardName").value = (user && user.displayName) || "";
        showView("onboard");
        return;
      }
      setError(byId("authError"), error.message);
      showView("auth");
    }
  }

  function wireAuth() {
    byId("googleSignInButton").addEventListener("click", async function () {
      setError(byId("authError"), "");
      try {
        var provider = new window.firebase.auth.GoogleAuthProvider();
        await auth.signInWithPopup(provider);
      } catch (error) {
        setError(byId("authError"), friendlyAuthError(error));
      }
    });

    byId("authModeToggle").addEventListener("click", function () {
      authMode = authMode === "signin" ? "signup" : "signin";
      var signingIn = authMode === "signin";
      byId("emailAuthSubmit").innerHTML = (signingIn ? "Sign in" : "Create account") + ' <span aria-hidden="true">→</span>';
      byId("authSwitchPrompt").textContent = signingIn ? "New to Attira?" : "Already have an account?";
      byId("authModeToggle").textContent = signingIn ? "Create an account" : "Sign in instead";
      byId("authPassword").setAttribute("autocomplete", signingIn ? "current-password" : "new-password");
      setError(byId("authError"), "");
    });

    byId("emailAuthForm").addEventListener("submit", async function (event) {
      event.preventDefault();
      setError(byId("authError"), "");
      var email = byId("authEmail").value.trim();
      var password = byId("authPassword").value;
      try {
        if (authMode === "signup") await auth.createUserWithEmailAndPassword(email, password);
        else await auth.signInWithEmailAndPassword(email, password);
      } catch (error) {
        setError(byId("authError"), friendlyAuthError(error));
      }
    });

    byId("onboardForm").addEventListener("submit", async function (event) {
      event.preventDefault();
      setError(byId("onboardError"), "");
      var displayName = byId("onboardName").value.trim();
      var code = byId("onboardCode").value.trim().toUpperCase();
      if (!displayName) return setError(byId("onboardError"), "Please enter a display name.");
      if (code && !CODE_RE.test(code)) {
        return setError(byId("onboardError"), "Codes are 3–32 letters, numbers or underscores.");
      }
      var body = { display_name: displayName };
      // Omit rather than send "" — a blank code fails the API's pattern check,
      // whereas omitting it asks the server to generate one.
      if (code) body.referral_code = code;
      try {
        creator = await api("/referrals/creator/auth/signup", { method: "POST", body: body });
        capture("creator_account_created", { has_custom_code: Boolean(code) });
        openDashboard();
      } catch (error) {
        setError(byId("onboardError"), error.message);
      }
    });

    byId("onboardSignOut").addEventListener("click", function () { auth.signOut(); });
    byId("logoutButton").addEventListener("click", function () { auth.signOut(); });
  }

  /* ── Dashboard interactions ───────────────────────────────────── */

  function wireDashboard() {
    Array.prototype.forEach.call(document.querySelectorAll("[data-period]"), function (button) {
      button.addEventListener("click", function () {
        currentPeriod = button.getAttribute("data-period");
        Array.prototype.forEach.call(document.querySelectorAll("[data-period]"), function (other) {
          other.classList.toggle("is-active", other === button);
        });
        loadMetrics();
      });
    });

    byId("codeInput").addEventListener("input", function () {
      var input = byId("codeInput");
      input.value = input.value.replace(/\s+/g, "").toUpperCase();
    });

    byId("codeForm").addEventListener("submit", async function (event) {
      event.preventDefault();
      setError(byId("codeError"), "");
      setError(byId("codeOk"), "");
      var code = byId("codeInput").value.trim().toUpperCase();
      if (!CODE_RE.test(code)) {
        return setError(byId("codeError"), "Codes are 3–32 letters, numbers or underscores.");
      }
      if (code === creator.referral_code) return setError(byId("codeOk"), "That’s already your code.");
      try {
        creator = await api("/referrals/creator/auth/code", { method: "PUT", body: { referral_code: code } });
        renderProfile();
        setError(byId("codeOk"), "Updated. Your previous link still works.");
        capture("creator_code_updated", {});
      } catch (error) {
        setError(byId("codeError"), error.message);
        byId("codeInput").value = creator.referral_code || "";
      }
    });

    byId("copyButton").addEventListener("click", async function () {
      var link = referralLinkFor(creator.referral_code);
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(link);
        } else {
          var area = document.createElement("textarea");
          area.value = link;
          area.style.position = "fixed";
          area.style.opacity = "0";
          document.body.appendChild(area);
          area.select();
          document.execCommand("copy");
          area.remove();
        }
        showToast("Link copied");
        capture("creator_link_copied", {});
      } catch (_) {
        showToast("Couldn’t copy — select the link and copy it manually");
      }
    });

    byId("shareButton").addEventListener("click", async function () {
      var link = referralLinkFor(creator.referral_code);
      if (navigator.share) {
        try {
          await navigator.share({ title: "Join Attira", text: "Discover your personal style with Attira.", url: link });
          capture("creator_link_shared", {});
        } catch (_) { /* user dismissed the sheet */ }
        return;
      }
      byId("copyButton").click();
    });
  }

  /* ── Boot ─────────────────────────────────────────────────────── */

  function wireNavigation() {
    Array.prototype.forEach.call(document.querySelectorAll("[data-open-auth]"), function (button) {
      button.addEventListener("click", function () { showView(auth && auth.currentUser ? "dashboard" : "auth"); });
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-show-landing]"), function (button) {
      button.addEventListener("click", function () { showView("landing"); });
    });
  }

  async function boot() {
    wireNavigation();

    try {
      var response = await fetch("/api/creator/config");
      config = await response.json();
    } catch (_) {
      config = null;
    }

    // An unconfigured deployment must show an explanation, never a dead form.
    if (!config || !config.apiBase || !config.firebase || !config.firebase.apiKey || !window.firebase) {
      byId("authUnavailable").hidden = false;
      byId("googleSignInButton").disabled = true;
      byId("emailAuthForm").hidden = true;
      byId("authModeToggle").hidden = true;
      byId("authSwitchPrompt").hidden = true;
      return;
    }

    window.firebase.initializeApp(config.firebase);
    auth = window.firebase.auth();
    if (config.authEmulatorUrl) auth.useEmulator(config.authEmulatorUrl, { disableWarnings: true });

    wireAuth();
    wireDashboard();

    auth.onAuthStateChanged(function (user) {
      if (user) {
        capture("creator_signed_in", {});
        resolveCreator();
      } else {
        creator = null;
        // ?view=signin lets us link creators straight to the sign-in card.
        var wantsAuth = new URLSearchParams(window.location.search).get("view") === "signin";
        showView(wantsAuth ? "auth" : "landing");
      }
    });
  }

  boot();
})();
