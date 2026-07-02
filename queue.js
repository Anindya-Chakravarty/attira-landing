/* ===================================================================
   Attira — public waitlist queue (/queue)
   Shows everyone on the list in the order they joined (first to enter
   their email = #1). Emails are masked; raw addresses never reach the
   client. Separate from the referral-weighted position/leaderboard on
   the homepage and /status — this is pure signup order.

   Talks only to the existing API:
     GET /api/waitlist/queue?limit=100&offset=0
       → { ok, total, limit, offset, rows: [{ position, maskedEmail, joinedAt }] }
   =================================================================== */

(function () {
  "use strict";

  var PAGE_SIZE = 100;

  var sub = document.getElementById("queueSub");
  var msg = document.getElementById("queueMsg");
  var board = document.getElementById("queueBoard");
  var list = document.getElementById("queueList");
  var moreBtn = document.getElementById("queueMore");

  var offset = 0;
  var total = 0;
  var loading = false;

  function setMsg(text, kind) {
    if (!msg) return;
    msg.textContent = text || "";
    msg.className = "waitlist__msg" + (kind ? " is-" + kind : "");
  }

  /* "247 people in line" — keep the subtitle honest as we learn the total. */
  function setSubtitle(n) {
    if (!sub) return;
    if (!n) {
      sub.textContent = "No one's in line yet — be the first.";
    } else {
      sub.textContent =
        n.toLocaleString() + (n === 1 ? " person" : " people") + " in line, in the order they joined.";
    }
  }

  /* "2026-06-08 07:50:49" (UTC) → "Jun 8, 2026". Falls back to the raw
     string if parsing fails so a row never renders blank. */
  function formatJoined(raw) {
    if (!raw) return "";
    var iso = String(raw).replace(" ", "T") + "Z";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(raw);
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }

  function renderRows(rows) {
    rows.forEach(function (r) {
      var li = document.createElement("li");
      li.className = "board__row";

      var left = document.createElement("div");
      left.className = "board__left";
      var rank = document.createElement("span");
      rank.className = "board__rank";
      rank.textContent = r.position;
      var em = document.createElement("span");
      em.className = "board__email";
      em.textContent = r.maskedEmail;
      left.appendChild(rank);
      left.appendChild(em);

      var date = document.createElement("span");
      date.className = "board__date";
      date.textContent = formatJoined(r.joinedAt);

      li.appendChild(left);
      li.appendChild(date);
      list.appendChild(li);
    });
  }

  function load() {
    if (loading) return;
    loading = true;
    if (moreBtn) moreBtn.disabled = true;

    fetch("/api/waitlist/queue?limit=" + PAGE_SIZE + "&offset=" + offset, {
      headers: { Accept: "application/json" },
    })
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(function (data) {
        if (!data || !data.ok) throw new Error("Bad response");
        total = data.total || 0;
        setSubtitle(total);

        var rows = data.rows || [];
        if (offset === 0 && !rows.length) {
          board.hidden = true;
          return;
        }
        renderRows(rows);
        board.hidden = false;
        offset += rows.length;

        if (moreBtn) moreBtn.hidden = offset >= total || rows.length === 0;
      })
      .catch(function () {
        setMsg("Couldn't load the queue right now. Please refresh in a moment.", "error");
      })
      .finally(function () {
        loading = false;
        if (moreBtn) moreBtn.disabled = false;
      });
  }

  if (moreBtn) moreBtn.addEventListener("click", load);
  load();
})();
