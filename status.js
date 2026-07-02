/* ===================================================================
   Attira — waitlist status page (/status)
   A standalone, bookmarkable/emailable view of a member's place in
   line + the public leaderboard. The flywheel: your position improves
   every time a friend joins through your link.

   Identifies the member by their share code, in priority order:
     1. ?code=ATR-XXXXX in the URL   (works across devices — email links)
     2. localStorage "attira.shareCode" (set on the homepage after signup)
     3. neither → show the public leaderboard + a "find my spot" entry.

   Talks only to the existing API (no new endpoints):
     GET /api/waitlist/stats?code=ATR-XXXXX  → personal stats + leaderboard
     GET /api/waitlist/public                → total + leaderboard
   Share links use /r/ATR-XXXXX (homepage referral redirect).
   =================================================================== */

(function () {
  "use strict";

  var STORAGE_KEY = "attira.shareCode";
  var SHARE_CODE_RE = /^ATR-[A-Z0-9]{5}$/;

  var sub = document.getElementById("statusSub");
  var msg = document.getElementById("statusMsg");
  var codeForm = document.getElementById("codeForm");
  var codeInput = document.getElementById("codeInput");
  var joinPrompt = document.getElementById("joinPrompt");
  var dash = document.getElementById("waitlistDash");
  var board = document.getElementById("waitlistBoard");
  var boardList = document.getElementById("boardList");

  function setMsg(text, kind) {
    if (!msg) return;
    msg.textContent = text || "";
    msg.className = "waitlist__msg" + (kind ? " is-" + kind : "");
  }

  function normalizeCode(raw) {
    if (!raw) return null;
    var code = String(raw).trim().toUpperCase();
    return SHARE_CODE_RE.test(code) ? code : null;
  }

  function readCodeFromUrl() {
    return normalizeCode(new URLSearchParams(window.location.search).get("code"));
  }

  function readStoredCode() {
    try {
      return normalizeCode(window.localStorage.getItem(STORAGE_KEY));
    } catch (e) {
      return null;
    }
  }

  /* ---------- Leaderboard (shared by both states) ---------- */
  function renderLeaderboard(rows, myCode) {
    if (!board || !boardList) return;
    boardList.innerHTML = "";
    if (!rows || !rows.length) {
      var empty = document.createElement("li");
      empty.className = "board__empty";
      empty.textContent = "Be the first to refer a friend and top the leaderboard.";
      boardList.appendChild(empty);
    } else {
      rows.forEach(function (r) {
        var li = document.createElement("li");
        li.className = "board__row";
        if (myCode && r.shareCode === myCode) li.className += " is-you";

        var left = document.createElement("div");
        left.className = "board__left";
        var rank = document.createElement("span");
        rank.className = "board__rank";
        rank.textContent = r.rank;
        var em = document.createElement("span");
        em.className = "board__email";
        em.textContent = (myCode && r.shareCode === myCode) ? "You" : r.maskedEmail;
        left.appendChild(rank);
        left.appendChild(em);

        var count = document.createElement("span");
        count.className = "board__count";
        count.textContent = r.referralCount;

        li.appendChild(left);
        li.appendChild(count);
        boardList.appendChild(li);
      });
    }
    board.hidden = false;
  }

  /* ---------- Share-intent analytics ---------- */
  function trackShare(channel) {
    if (window.posthog && typeof window.posthog.capture === "function") {
      window.posthog.capture("referral_share_clicked", { channel: channel });
    }
  }

  /* ---------- Two-sided reward state ---------- */
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

  /* ---------- Personal dashboard ---------- */
  function renderDashboard(data) {
    if (!dash) return;
    var origin = window.location.origin;
    var shareUrl = origin + "/r/" + data.shareCode;

    var ref = data.referralCount || 0;
    var pos = data.position;
    var total = data.total || 0;

    document.getElementById("dashPosition").textContent = pos ? "#" + pos : "#—";
    document.getElementById("dashReferrals").textContent = ref;

    applyReward(data);

    document.getElementById("dashLink").value = shareUrl;
    document.getElementById("dashCode").textContent = data.shareCode;

    wireShare(data.shareCode);
    wireStory(data);

    // Flywheel framing in the subhead: how far ahead they are + the nudge.
    if (sub) {
      var ahead = pos && total ? Math.max(0, total - pos) : 0;
      var reward = data.reward || {};
      if (reward.nextTier) {
        sub.textContent =
          "You're ahead of " + ahead.toLocaleString() + " people. Refer " +
          reward.toNext + " more friend" + (reward.toNext === 1 ? "" : "s") +
          " to unlock " + reward.nextTier + ".";
      } else {
        sub.textContent =
          "You're ahead of " + ahead.toLocaleString() +
          " people and you've unlocked every reward. Keep sharing to climb even higher.";
      }
    }

    renderLeaderboard(data.leaderboard, data.shareCode);

    if (codeForm) codeForm.hidden = true;
    if (joinPrompt) joinPrompt.hidden = true;
    dash.hidden = false;
  }

  /* ---------- Copy-to-clipboard ---------- */
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

  /* ---------- Data loaders ---------- */
  function loadStats(code) {
    setMsg("Finding your spot…");
    return fetch("/api/waitlist/stats?code=" + encodeURIComponent(code))
      .then(function (res) {
        if (res.status === 404) return { notFound: true };
        return res.json();
      })
      .then(function (data) {
        if (data && data.notFound) {
          try { window.localStorage.removeItem(STORAGE_KEY); } catch (e) {}
          setMsg("We couldn't find that code. Check it and try again.", "err");
          showCodeEntry();
          return;
        }
        if (data && data.ok) {
          try { window.localStorage.setItem(STORAGE_KEY, code); } catch (e) {}
          setMsg("");
          renderDashboard(data);
        } else {
          setMsg("Something went wrong. Please try again.", "err");
          showCodeEntry();
        }
      })
      .catch(function () {
        setMsg("Couldn't reach the server. Please try again in a moment.", "err");
        showCodeEntry();
      });
  }

  // No code: show the public leaderboard + total, and the code-entry form.
  function showCodeEntry() {
    if (dash) dash.hidden = true;
    if (codeForm) codeForm.hidden = false;
    if (joinPrompt) joinPrompt.hidden = false;
    if (codeInput) codeInput.focus();

    fetch("/api/waitlist/public")
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (!data || !data.ok) return;
        if (sub) {
          sub.textContent =
            (data.total || 0).toLocaleString() +
            " people are in line. Enter your code (from your confirmation) to see your spot — or refer friends to climb.";
        }
        renderLeaderboard(data.leaderboard, null);
      })
      .catch(function () { /* leave the form in place on network error */ });
  }

  /* ---------- Code-entry form ---------- */
  if (codeForm && codeInput) {
    codeForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var code = normalizeCode(codeInput.value);
      if (!code) {
        setMsg("That doesn't look like a valid code (ATR-XXXXX).", "err");
        codeInput.focus();
        return;
      }
      // Reflect the code in the URL so the page is now shareable/refreshable…
      try {
        var url = window.location.pathname + "?code=" + encodeURIComponent(code);
        window.history.replaceState(null, "", url);
      } catch (e2) { /* non-fatal */ }
      loadStats(code);
    });
  }

  /* ---------- Boot ---------- */
  var initialCode = readCodeFromUrl() || readStoredCode();
  if (initialCode) {
    loadStats(initialCode);
  } else {
    setMsg("");
    showCodeEntry();
  }
})();
