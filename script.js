/* ===================================================================
   Attira — interactivity
   1. Mobile nav toggle
   2. Close mobile nav on link click
   3. Interactive Discover screen switcher (tap the tab bar to swap screens)
   4. Waitlist form validation + success message
   =================================================================== */

(function () {
  "use strict";

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

  /* ---------- 3. Discover scroll-driven showcase ---------- */
  /* The phone is pinned (CSS sticky) while the section scrolls. Scroll progress
     drives a continuous crossfade between the 5 stacked screenshots (fade +
     slight rise), the active left-nav item, the in-phone tab, and the copy.
     Falls back to a click stepper without JS / with reduced motion. */
  var shotsWrap = document.getElementById("screenShots");

  if (shotsWrap) {
    var STEPS = [
      { title: "Discover<em>.</em>", desc: "Explore outfit ideas curated from real wardrobes, trends, moods, and occasions — personalised to your style." },
      { title: "Wardrobe<em>.</em>", desc: "Your entire closet, digitised and organised — every piece you own, a tap away." },
      { title: "Aira<em>.</em>", desc: "Chat with Aira, your personal AI stylist, for looks that fit your day and mood." },
      { title: "Saved<em>.</em>", desc: "Keep your favourite outfits in one place and build looks you'll actually wear." },
      { title: "Account<em>.</em>", desc: "Your Style DNA and wardrobe insights, tuned to how you really dress." }
    ];

    var discover = document.getElementById("discover");
    var scrollEl = document.getElementById("discoverScroll");
    var shots = shotsWrap.querySelectorAll(".device__shot");
    var tabs = document.querySelectorAll("#phoneTabs .ptab");
    var steps = document.querySelectorAll("#stepper .step");
    var stepTitle = document.getElementById("stepTitle");
    var stepDesc = document.getElementById("stepDesc");
    var copy = stepTitle ? stepTitle.closest(".discover__copy") : null;
    var N = shots.length;
    var clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };

    var activeIndex = -1;
    function syncActive(index) {
      if (index === activeIndex) return;
      activeIndex = index;
      tabs.forEach(function (t, i) { t.classList.toggle("is-active", i === index); });
      steps.forEach(function (b, i) { b.classList.toggle("is-active", i === index); });
      if (STEPS[index] && copy) {
        copy.classList.add("is-swapping");
        setTimeout(function () {
          if (stepTitle) stepTitle.innerHTML = STEPS[index].title;
          if (stepDesc) stepDesc.textContent = STEPS[index].desc;
          copy.classList.remove("is-swapping");
        }, 150);
      }
    }

    /* discrete fallback (no pin / reduced motion) */
    function setScreen(index) {
      shots.forEach(function (s, i) { s.classList.toggle("is-active", i === index); });
      syncActive(index);
    }

    var reduceMotion = window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var scrolly = !reduceMotion && "IntersectionObserver" in window;

    if (scrolly) {
      discover.classList.add("is-scrolly");

      /* z-index ordering is constant (higher index stacks above) — set once,
         not every frame */
      for (var zi = 0; zi < N; zi++) shots[zi].style.zIndex = zi;

      /* cache layout metrics so the per-frame loop doesn't force a reflow by
         reading offsetHeight on every scroll event (re-measured on resize) */
      var winH = window.innerHeight;
      var trackH = scrollEl.offsetHeight;
      function measure() { winH = window.innerHeight; trackH = scrollEl.offsetHeight; }

      /* Instant clean cut: exactly one screen is visible at any scroll
         position; it flips at the step boundary (Math.round rolls over at the
         midpoint) with no crossfade/overlap. Opacities are only rewritten when
         the active screen actually changes. */
      var shownIndex = -1;
      function update() {
        var span = trackH - winH;
        if (span <= 0) return;
        var progress = clamp(-scrollEl.getBoundingClientRect().top / span, 0, 1);
        var active = clamp(Math.round(progress * (N - 1)), 0, N - 1);
        if (active !== shownIndex) {
          shownIndex = active;
          for (var i = 0; i < N; i++) shots[i].style.opacity = i === active ? 1 : 0;
        }
        syncActive(active);
      }

      var ticking = false;
      function onScroll() {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(function () { update(); ticking = false; });
      }

      var live = false;
      var io = new IntersectionObserver(function (entries) {
        live = entries[0].isIntersecting;
        if (live) onScroll();
      }, { threshold: 0 });
      io.observe(scrollEl);

      window.addEventListener("scroll", function () { if (live) onScroll(); }, { passive: true });
      window.addEventListener("resize", function () { measure(); if (live) onScroll(); }, { passive: true });
      measure();
      update();

      /* clicking a nav item / tab smooth-scrolls to that screen's segment */
      function goTo(index) {
        var span = scrollEl.offsetHeight - window.innerHeight;
        if (span <= 0) return;
        var trackTop = scrollEl.getBoundingClientRect().top + window.scrollY;
        window.scrollTo({ top: trackTop + (index / (N - 1)) * span, behavior: "smooth" });
      }
      [].forEach.call(tabs, function (b) {
        b.addEventListener("click", function () { goTo(Number(b.getAttribute("data-step"))); });
      });
      [].forEach.call(steps, function (b) {
        b.addEventListener("click", function () { goTo(Number(b.getAttribute("data-step"))); });
      });
    } else {
      /* reduced motion / no IO: keep the click stepper */
      setScreen(0);
      [].forEach.call(tabs, function (b) {
        b.addEventListener("click", function () { setScreen(Number(b.getAttribute("data-step"))); });
      });
      [].forEach.call(steps, function (b) {
        b.addEventListener("click", function () { setScreen(Number(b.getAttribute("data-step"))); });
      });
    }
  }

  /* ---------- 4. Waitlist form ---------- */
  var form = document.getElementById("waitlistForm");
  var email = document.getElementById("email");
  var msg = document.getElementById("waitlistMsg");
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/; // matches server-side validation

  if (form) {
    var submitBtn = form.querySelector(".waitlist__submit");

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
        body: JSON.stringify({ email: value }),
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
          if (result.data.status === "existing") {
            msg.textContent = "You're already on the list — see you soon. ✦";
          } else {
            msg.textContent = "You're on the list! We'll be in touch soon. ✦";
          }
          msg.className = "waitlist__msg is-ok";
          form.reset();
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
