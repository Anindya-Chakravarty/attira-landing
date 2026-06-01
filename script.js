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

  /* ---------- 3. Discover screen switcher (stepper + clickable tab bar) ---------- */
  /* Each screenshot already contains the phone frame, the bottom tab bar,
     and its caption. We stack the full images and switch the visible one via
     either the numbered stepper or invisible hit zones over the tab bar.
     Both paths funnel through setScreen(), which also keeps the stepper
     highlight and the title/description copy in sync. */
  var switcher = document.getElementById("screenSwitcher");

  if (switcher) {
    var STEPS = [
      { title: "Discover<em>.</em>", desc: "Explore outfit ideas curated from real wardrobes, trends, moods, and occasions — personalised to your style." },
      { title: "Wardrobe<em>.</em>", desc: "Your entire closet, digitised and organised — every piece you own, a tap away." },
      { title: "Aira<em>.</em>", desc: "Chat with Aira, your personal AI stylist, for looks that fit your day and mood." },
      { title: "Saved<em>.</em>", desc: "Keep your favourite outfits in one place and build looks you'll actually wear." },
      { title: "Account<em>.</em>", desc: "Your Style DNA and wardrobe insights, tuned to how you really dress." }
    ];

    var screens = switcher.querySelectorAll(".screen-img");
    var tabHits = switcher.querySelectorAll(".tab-hit");
    var steps = document.querySelectorAll("#stepper .step");
    var stepTitle = document.getElementById("stepTitle");
    var stepDesc = document.getElementById("stepDesc");

    function setScreen(index) {
      screens.forEach(function (s, i) {
        s.classList.toggle("is-active", i === index);
      });
      steps.forEach(function (b, i) {
        b.classList.toggle("is-active", i === index);
      });
      if (STEPS[index]) {
        if (stepTitle) stepTitle.innerHTML = STEPS[index].title;
        if (stepDesc) stepDesc.textContent = STEPS[index].desc;
      }
    }

    tabHits.forEach(function (btn) {
      btn.addEventListener("click", function () {
        setScreen(Number(btn.getAttribute("data-step")));
      });
    });

    steps.forEach(function (btn) {
      btn.addEventListener("click", function () {
        setScreen(Number(btn.getAttribute("data-step")));
      });
    });
  }

  /* ---------- 4. Waitlist form ---------- */
  var form = document.getElementById("waitlistForm");
  var email = document.getElementById("email");
  var msg = document.getElementById("waitlistMsg");
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
