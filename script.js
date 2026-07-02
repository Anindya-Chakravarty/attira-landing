/* ===================================================================
   Attira — interactivity
   1. Mobile nav toggle
   2. Close mobile nav on link click
   3. Interactive Discover screen switcher (tap the tab bar to swap screens)
   4. Waitlist form validation + success message
   =================================================================== */

(function () {
  "use strict";

  /* ---------- 0. Light/dark theme toggle ---------- */
  /* The stored theme is already applied to <html> pre-paint by theme-init.js.
     Here we wire the navbar button: flip data-theme, persist the choice, keep the
     button's a11y state in sync, and swap the phone mockups (see applyMockupTheme). */
  var THEME_KEY = "attira-theme";
  var rootEl = document.documentElement;
  /* Both theme controls (navbar toggle + the slider beside the Discover phone)
     drive the same state; collect whichever are present. */
  var themeControls = [
    document.getElementById("themeToggle"),
    document.getElementById("themeSlider")
  ].filter(Boolean);

  /* Point every phone screenshot at its light or dark source. Dimensions are
     identical across variants, so swapping src causes no layout shift. */
  function applyMockupTheme(dark) {
    var imgs = document.querySelectorAll(".device__shot");
    [].forEach.call(imgs, function (img) {
      var next = dark ? img.getAttribute("data-src-dark") : img.getAttribute("data-src-light");
      if (next && img.getAttribute("src") !== next) img.setAttribute("src", next);
    });
  }

  function syncThemeControls(dark) {
    themeControls.forEach(function (el) {
      el.setAttribute("aria-pressed", String(dark));
      el.setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
    });
  }

  function setTheme(dark) {
    if (dark) rootEl.setAttribute("data-theme", "dark");
    else rootEl.removeAttribute("data-theme");
    try { localStorage.setItem(THEME_KEY, dark ? "dark" : "light"); } catch (e) {}
    syncThemeControls(dark);
    applyMockupTheme(dark);
  }

  themeControls.forEach(function (el) {
    el.addEventListener("click", function () {
      var dark = rootEl.getAttribute("data-theme") !== "dark"; // resulting theme
      setTheme(dark);
      // Track theme toggles so we can see who uses the slider (source='slider')
      // vs any future navbar toggle, and which mode they switch into.
      if (window.posthog && typeof window.posthog.capture === "function") {
        window.posthog.capture("theme_toggled", {
          source: el.id === "themeSlider" ? "slider" : "navbar",
          theme: dark ? "dark" : "light"
        });
      }
    });
  });
  /* Sync control state + image sources with the theme set pre-paint. */
  var startsDark = rootEl.getAttribute("data-theme") === "dark";
  applyMockupTheme(startsDark);
  if (startsDark) syncThemeControls(true);

  /* ---------- 1 & 2. Mobile nav ---------- */
  var toggle = document.getElementById("navToggle");
  var links = document.getElementById("navLinks");

  function closeNav() {
    links.classList.remove("is-open");
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-label", "Open menu");
  }

  if (toggle && links) {
    toggle.addEventListener("click", function () {
      var open = links.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded", String(open));
      toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    });

    links.querySelectorAll("a").forEach(function (a) {
      a.addEventListener("click", closeNav);
    });
  }

  var prefersReducedMotion = window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- 2b. Nav lift on scroll ---------- */
  /* Toggle .is-scrolled past the top so the sticky bar gains a subtle shadow.
     rAF-throttled, passive — mirrors the Discover scroll pattern. */
  var nav = document.querySelector(".nav");
  if (nav) {
    var navTicking = false;
    function syncNav() {
      nav.classList.toggle("is-scrolled", window.scrollY > 8);
      navTicking = false;
    }
    window.addEventListener("scroll", function () {
      if (navTicking) return;
      navTicking = true;
      requestAnimationFrame(syncNav);
    }, { passive: true });
    syncNav();
  }

  /* ---------- 2c. Scroll-reveal entrances ---------- */
  /* Progressive enhancement: the hidden initial state in CSS only applies once
     we add `js-reveal` to <html>. We skip it entirely under reduced motion (or
     without IntersectionObserver), leaving every [data-reveal] fully visible.
     Each element reveals once, then is unobserved. */
  var revealEls = document.querySelectorAll("[data-reveal]");
  if (revealEls.length && !prefersReducedMotion && "IntersectionObserver" in window) {
    document.documentElement.classList.add("js-reveal");
    var revealIO = new IntersectionObserver(function (entries, obs) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          obs.unobserve(entry.target);
        }
      });
    }, { threshold: 0, rootMargin: "0px 0px -12% 0px" });
    revealEls.forEach(function (el) { revealIO.observe(el); });
  }

  /* ---------- 2d. One-time theme-slider nudge ---------- */
  /* Few visitors notice the light/dark slider, so the first time it scrolls
     into view we pulse its knob once to signal it's interactive. Fires a single
     time, then removes the class; skipped under reduced motion (CSS also gates
     the animation behind prefers-reduced-motion: no-preference). */
  var themeSlider = document.getElementById("themeSlider");
  if (themeSlider && !prefersReducedMotion && "IntersectionObserver" in window) {
    var hintIO = new IntersectionObserver(function (entries, obs) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        obs.unobserve(entry.target);
        themeSlider.classList.add("is-hinting");
        themeSlider.addEventListener("animationend", function handler() {
          themeSlider.classList.remove("is-hinting");
          themeSlider.removeEventListener("animationend", handler);
        });
      });
    }, { threshold: 0.6 });
    hintIO.observe(themeSlider);
  }

  /* ---------- 3. Discover scroll-driven accordion showcase ---------- */
  /* The phone is pinned (CSS sticky) while the section scrolls. Scroll progress
     snaps to one of the 5 features; the active accordion row expands its copy
     inline, the matching screenshot + in-phone tab activate, and the phone
     screenshots crossfade (all driven by the .is-active class in CSS). Rows and
     up/down chevrons also jump directly (hybrid). Falls back to a pure click
     accordion without JS / with reduced motion. */
  var shotsWrap = document.getElementById("screenShots");

  if (shotsWrap) {
    var shots = shotsWrap.querySelectorAll(".device__shot");
    var tabs = document.querySelectorAll("#phoneTabs .ptab");
    var rows = document.querySelectorAll("#stepper .feature");
    var prevBtn = document.getElementById("accPrev");
    var nextBtn = document.getElementById("accNext");
    var N = shots.length;
    var clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };

    /* `activeIndex` is the feature the phone is showing (always >= 0 once loaded).
       `openIndex` is the expanded accordion row, which may be -1 (all collapsed).
       Decoupling them lets a tile close on a second click while the phone keeps
       displaying the last-opened screenshot rather than going blank. */
    var activeIndex = -1;
    var openIndex = -1;

    /* Expand exactly `index` (or none when -1). Never touches the phone. */
    function setOpen(index) {
      if (index === openIndex) return;
      openIndex = index;
      rows.forEach(function (r, i) {
        var on = i === index;
        r.classList.toggle("is-active", on);
        var head = r.querySelector(".feature__head");
        if (head) head.setAttribute("aria-expanded", on ? "true" : "false");
      });
    }

    /* Point the phone (screenshots + in-phone tabs) at `index`. Phone-only. */
    function syncActive(index) {
      if (index === activeIndex) return;
      activeIndex = index;
      tabs.forEach(function (t, i) { t.classList.toggle("is-active", i === index); });
      shots.forEach(function (s, i) { s.classList.toggle("is-active", i === index); });
      if (prevBtn) prevBtn.disabled = index <= 0;
      if (nextBtn) nextBtn.disabled = index >= N - 1;
    }

    /* Open a feature: expand its row AND switch the phone to it. */
    function setScreen(index) {
      syncActive(index);
      setOpen(index);
    }

    /* index of an accordion row from its data-step (or its DOM order) */
    function rowStep(r) {
      var d = r.getAttribute("data-step");
      return d == null ? 0 : Number(d);
    }

    /* Unified click/tap accordion — same on every device. Clicking a row (or the
       up/down chevrons, or a phone tab if present) opens that feature in place and
       crossfades the phone; CSS owns the expand + screenshot transition. No
       scroll-jacking, so behaviour is identical across desktop and mobile. */
    setScreen(0);
    [].forEach.call(tabs, function (b) {
      b.addEventListener("click", function () { setScreen(Number(b.getAttribute("data-step"))); });
    });
    [].forEach.call(rows, function (r) {
      var head = r.querySelector(".feature__head");
      if (head) head.addEventListener("click", function () {
        var step = rowStep(r);
        if (step === openIndex) setOpen(-1);   /* click the open tile → collapse (phone unchanged) */
        else setScreen(step);                  /* otherwise open it + switch the phone */
      });
    });
    if (prevBtn) prevBtn.addEventListener("click", function () { setScreen(clamp(activeIndex - 1, 0, N - 1)); });
    if (nextBtn) nextBtn.addEventListener("click", function () { setScreen(clamp(activeIndex + 1, 0, N - 1)); });
  }

  /* ---------- 4. Waitlist form ---------- */
  var form = document.getElementById("waitlistForm");
  var email = document.getElementById("email");
  var msg = document.getElementById("waitlistMsg");
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/; // matches server-side validation

  // Read UTM parameters from the current URL so we can attribute the signup
  // to the channel that drove the visit (utm_source/medium/campaign/term/content).
  function readUtmParams() {
    var params = new URLSearchParams(window.location.search);
    var utm = {};
    ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"].forEach(
      function (key) {
        var val = params.get(key);
        if (val) utm[key] = val.slice(0, 200);
      }
    );
    return utm;
  }

  /* ----- Referral dashboard helpers ----- */
  var STORAGE_KEY = "attira.shareCode";
  var SHARE_CODE_RE = /^ATR-[A-Z0-9]{5}$/;

  var dash = document.getElementById("waitlistDash");
  var invited = document.getElementById("waitlistInvited");
  var invitedCode = document.getElementById("waitlistInvitedCode");

  // Read the ?ref=ATR-XXXXX referral code from the URL, if valid.
  function readRef() {
    var raw = new URLSearchParams(window.location.search).get("ref");
    if (!raw) return null;
    var code = raw.trim().toUpperCase();
    return SHARE_CODE_RE.test(code) ? code : null;
  }
  var refCode = readRef();

  // Paint the personal dashboard from a stats payload and swap out the form.
  // Record a share-intent click so we can compare share-through across
  // channels in PostHog (which surface actually drives referrals).
  function trackShare(channel) {
    if (window.posthog && typeof window.posthog.capture === "function") {
      window.posthog.capture("referral_share_clicked", { channel: channel });
    }
  }

  // Paint the two-sided reward state from the server's reward payload:
  // the perks earned so far, plus progress toward the next tier.
  function applyReward(data) {
    var reward = data.reward || {};
    var ref = data.referralCount || 0;
    var rewardEl = document.getElementById("dashReward");
    var textEl = document.getElementById("dashProgressText");
    var countEl = document.getElementById("dashProgressCount");
    var fillEl = document.getElementById("dashBarFill");

    var nextAt = reward.nextTierAt;
    var pct = nextAt ? Math.min(100, (ref / nextAt) * 100) : 100;
    if (fillEl) fillEl.style.width = pct + "%";
    if (countEl) countEl.textContent = ref + "/" + (nextAt || 25);
    if (textEl) {
      if (reward.nextTier) {
        var n = reward.toNext;
        textEl.textContent =
          "Refer " + n + " more friend" + (n === 1 ? "" : "s") +
          " to unlock " + reward.nextTier;
      } else {
        textEl.textContent = "Every reward unlocked — you're a founding member ✦";
      }
    }

    if (rewardEl) {
      var parts = [];
      if (reward.founder) parts.push("Founder status + 6 months Premium unlocked");
      else if (reward.premiumMonths > 0)
        parts.push("Priority access + " + reward.premiumMonths + " month" +
          (reward.premiumMonths === 1 ? "" : "s") + " Premium unlocked");
      else if (reward.priority) parts.push("Priority access unlocked");
      if (reward.isReferee && reward.refereePremiumWeeks)
        parts.push(reward.refereePremiumWeeks + " weeks Premium credited for joining a friend's link");
      if (parts.length) {
        rewardEl.textContent = "✦ " + parts.join(" · ");
        rewardEl.hidden = false;
      } else {
        rewardEl.hidden = true;
      }
    }
  }

  // Point the WhatsApp/X/Email share buttons at the member's link, each
  // carrying its own ?c= channel tag so the resulting referral is attributed.
  function wireShare(code) {
    var origin = window.location.origin;
    function link(ch) { return origin + "/r/" + code + (ch ? "?c=" + ch : ""); }
    function text(ch) {
      return "I just joined the Attira waitlist — join with my link and we both move up the queue: " + link(ch);
    }
    var wa = document.getElementById("dashWhatsApp");
    var x = document.getElementById("dashX");
    var em = document.getElementById("dashEmail");
    if (wa) {
      wa.href = "https://wa.me/?text=" + encodeURIComponent(text("wa"));
      wa.onclick = function () { trackShare("wa"); };
    }
    if (x) {
      x.href = "https://twitter.com/intent/tweet?text=" + encodeURIComponent(text("x"));
      x.onclick = function () { trackShare("x"); };
    }
    if (em) {
      em.href = "mailto:?subject=" + encodeURIComponent("Join the Attira waitlist") +
        "&body=" + encodeURIComponent(text("em"));
      em.onclick = function () { trackShare("em"); };
    }
  }

  // Wire the "Share to Story" button — builds the branded image card on tap
  // and hands it to the native share sheet (or downloads it as a fallback).
  function wireStory(data) {
    var btn = document.getElementById("dashStory");
    var hint = document.getElementById("dashStoryHint");
    if (!btn) return;
    btn.onclick = function () {
      if (!window.AttiraShareCard) return;
      var original = btn.textContent;
      btn.disabled = true;
      btn.textContent = "Creating your card…";
      window.AttiraShareCard.share(data, function () { trackShare("ig"); })
        .then(function (res) {
          if (!hint) return;
          if (res && res.method === "downloaded") {
            hint.textContent = "Saved to your device — post it to your story and tag @attira.closet ✦";
            hint.hidden = false;
          } else if (res && res.method === "shared") {
            hint.textContent = "Nice — tag @attira.closet so we can reshare you ✦";
            hint.hidden = false;
          }
        })
        .catch(function () {
          if (hint) {
            hint.textContent = "Couldn't create the card — try the WhatsApp button instead.";
            hint.hidden = false;
          }
        })
        .then(function () { btn.disabled = false; btn.textContent = original; });
    };
  }

  function renderDashboard(data) {
    if (!dash) return;
    var origin = window.location.origin;
    var shareUrl = origin + "/r/" + data.shareCode;
    var ref = data.referralCount || 0;
    var pos = data.position;

    document.getElementById("dashPosition").textContent = pos ? "#" + pos : "#—";
    document.getElementById("dashReferrals").textContent = ref;

    applyReward(data);

    document.getElementById("dashLink").value = shareUrl;
    document.getElementById("dashCode").textContent = data.shareCode;

    wireShare(data.shareCode);
    wireStory(data);

    // Swap the form/invite for the dashboard.
    if (form) form.hidden = true;
    if (invited) invited.hidden = true;
    dash.hidden = false;
  }

  // Copy-to-clipboard with checkmark-style feedback on the button.
  var copyBtn = document.getElementById("dashCopy");
  if (copyBtn) {
    copyBtn.addEventListener("click", function () {
      var link = document.getElementById("dashLink");
      if (!link) return;
      var done = function () {
        copyBtn.textContent = "Copied ✦";
        copyBtn.classList.add("is-copied");
        setTimeout(function () {
          copyBtn.textContent = "Copy";
          copyBtn.classList.remove("is-copied");
        }, 1600);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(link.value).then(done, function () {
          link.select();
          done();
        });
      } else {
        link.select();
        try { document.execCommand("copy"); } catch (e) {}
        done();
      }
    });
  }

  if (form) {
    var submitBtn = form.querySelector(".waitlist__submit");

    // Show the "invited by" hint when arriving via a referral link.
    if (refCode && invited && invitedCode) {
      invitedCode.textContent = refCode;
      invited.hidden = false;
    }

    // Restore the dashboard for returning visitors who already have a code.
    var storedCode = null;
    try { storedCode = window.localStorage.getItem(STORAGE_KEY); } catch (e) {}
    if (storedCode && SHARE_CODE_RE.test(storedCode)) {
      fetch("/api/waitlist/stats?code=" + encodeURIComponent(storedCode))
        .then(function (res) {
          if (res.status === 404) {
            try { window.localStorage.removeItem(STORAGE_KEY); } catch (e) {}
            return null;
          }
          return res.json();
        })
        .then(function (data) {
          if (data && data.ok) renderDashboard(data);
        })
        .catch(function () { /* leave the form in place on network error */ });
    }

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var value = email.value.trim();

      if (!EMAIL_RE.test(value)) {
        msg.textContent = "Please enter a valid email address.";
        msg.className = "waitlist__msg is-err";
        email.focus();
        return;
      }

      // Send the email to the backend so it's saved in the database.
      msg.textContent = "Adding you…";
      msg.className = "waitlist__msg";
      if (submitBtn) submitBtn.disabled = true;

      fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: value, utm: readUtmParams(), ref: refCode || undefined }),
      })
        .then(function (res) {
          return res.json().then(function (data) {
            return { ok: res.ok, data: data };
          });
        })
        .then(function (result) {
          if (!result.ok || !result.data.ok) {
            throw new Error((result.data && result.data.error) || "Request failed");
          }
          // Link this anonymous (UTM-bearing) visitor to their email so the
          // signup is attributed to the channel they arrived from in PostHog.
          if (window.posthog && typeof window.posthog.identify === "function") {
            window.posthog.identify(value);
          }
          if (result.data.status === "existing") {
            msg.textContent = "You're already on the list — here's your spot. ✦";
          } else {
            msg.textContent = "You're in. Share your link to climb the queue. ✦";
          }
          msg.className = "waitlist__msg is-ok";

          // Persist the share code and render the personal dashboard.
          if (result.data.shareCode) {
            try { window.localStorage.setItem(STORAGE_KEY, result.data.shareCode); } catch (e) {}
            renderDashboard(result.data);
          }
        })
        .catch(function (err) {
          msg.textContent =
            (err && err.message) ||
            "Something went wrong. Please try again in a moment.";
          msg.className = "waitlist__msg is-err";
        })
        .finally(function () {
          if (submitBtn) submitBtn.disabled = false;
        });
    });
  }

  /* ---------- 5. FAQ accordion (legal/faq pages) ---------- */
  /* Each question is a button; its answer is the next sibling, hidden by
     default. Clicking toggles aria-expanded and the answer's [hidden]. */
  var faqButtons = document.querySelectorAll(".faq__q");

  faqButtons.forEach(function (btn) {
    btn.addEventListener("click", function () {
      var expanded = btn.getAttribute("aria-expanded") === "true";
      btn.setAttribute("aria-expanded", String(!expanded));

      var answer = btn.nextElementSibling;
      if (answer) {
        if (expanded) {
          answer.setAttribute("hidden", "");
        } else {
          answer.removeAttribute("hidden");
        }
      }
    });
  });
})();
