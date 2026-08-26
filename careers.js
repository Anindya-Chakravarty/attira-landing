/* ===================================================================
   Attira — careers application form engine

   This file is the ENGINE only. Every question, option list and format
   rule lives in careers-roles.js, which the server also require()s — so
   the form and the API validate against the same spec and cannot drift.
   Adding or changing a question is a careers-roles.js edit; nothing here
   needs to know which role is on screen.

   Written in the same plain-ES5 style as queue.js / status.js — no build
   step, no bundler. All DOM is built with createElement/textContent, so
   nothing here needs a CSP relaxation and no user input is ever parsed
   as HTML.
   =================================================================== */
(function () {
  "use strict";

  var SPEC = window.ATTIRA_CAREERS;
  var form = document.getElementById("applyForm");
  if (!form || !SPEC) return;

  var elSteps = document.getElementById("applySteps");
  var elMsg = document.getElementById("applyMsg");
  var elBack = document.getElementById("applyBack");
  var elNext = document.getElementById("applyNext");
  var elSkip = document.getElementById("applySkip");
  var elSubmit = document.getElementById("applySubmit");
  var elProgress = document.getElementById("applyProgress");
  var elProgressFill = document.getElementById("applyProgressFill");
  var elProgressCount = document.getElementById("applyProgressCount");
  var elTitle = document.getElementById("applyTitle");
  var elDone = document.getElementById("applyDone");
  var elDoneRef = document.getElementById("applyDoneRef");
  var elDoneRole = document.getElementById("applyDoneRole");
  var elNoJs = document.getElementById("applyNoJs");
  var elApply = document.getElementById("apply");
  var elHead = document.querySelector(".apply__head");

  var trim = SPEC.trimStr;
  var normalizePhone = SPEC.normalizePhone;
  var digitsOnly = SPEC.digitsOnly;
  var CURRENCIES = SPEC.CURRENCIES;
  var MAX_LINKS = SPEC.MAX_LINKS;

  /* ── state ──────────────────────────────────────────────────────── */

  var state = {
    role: null,        // the role object from careers-roles.js
    step: 0,
    submitting: false,
    done: false,
    answers: {},
    /* File fields keep the server's opaque key in `answers` (a string, so
       validation and the draft both behave) and the human-readable
       filename here, keyed by field name. */
    uploads: {},
    uploading: {}
  };
  var errors = {};

  function steps() { return state.role ? state.role.steps : []; }
  function total() { return steps().length; }

  /* ── helpers ────────────────────────────────────────────────────── */

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  /* Focus WITHOUT scrolling. Focusing an element — especially one with
     tabindex="-1" — makes the browser scroll it into view by default,
     which is half of why step changes used to jump the page. The focus
     call itself has to stay: it is what announces the new step to screen
     readers.

     A try/catch is NOT enough to detect support: browsers that don't know
     `preventScroll` don't throw, they just ignore it and scroll anyway. So
     probe for it via a getter on a detached node (detached, so the probe
     itself can never scroll the page). Safari only shipped preventScroll in
     15.4, and older iOS is a real slice of Indian traffic. */
  var SUPPORTS_PREVENT_SCROLL = (function () {
    var supported = false;
    try {
      var probe = document.createElement("div");
      probe.tabIndex = -1;
      probe.focus(Object.defineProperty({}, "preventScroll", {
        get: function () { supported = true; return true; }
      }));
    } catch (e) {}
    return supported;
  })();

  function focusNoScroll(node) {
    if (!node || !node.focus) return;
    if (SUPPORTS_PREVENT_SCROLL) { node.focus({ preventScroll: true }); return; }
    // Fallback: let it scroll, then put the page back. The scroll-behavior
    // swap is required — window.scrollTo() resolves "auto" against the CSS
    // property, so under html{scroll-behavior:smooth} the restore would
    // itself animate. (Don't use {behavior:"instant"} — engines that don't
    // know that enum value throw on the whole dictionary.)
    var root = document.documentElement;
    var prev = root.style.scrollBehavior;
    var x = window.pageXOffset, y = window.pageYOffset;
    root.style.scrollBehavior = "auto";
    node.focus();
    window.scrollTo(x, y);
    root.style.scrollBehavior = prev;
  }

  /* Scroll helpers that defeat html{scroll-behavior:smooth} — without the
     swap these "corrections" animate, which is the very lurch we're removing. */
  function scrollToY(y) {
    var root = document.documentElement;
    var prev = root.style.scrollBehavior;
    root.style.scrollBehavior = "auto";
    window.scrollTo(0, y);
    root.style.scrollBehavior = prev;
  }

  /* Undo a scroll caused by content ABOVE the viewport changing height —
     used by the JD toggle, where collapsing a card pulls everything below
     it upward. Not used for step changes; see renderStable(). */
  function scrollByDelta(delta) {
    if (!delta) return;
    var root = document.documentElement;
    var prev = root.style.scrollBehavior;
    root.style.scrollBehavior = "auto";
    window.scrollBy(0, delta);
    root.style.scrollBehavior = prev;
  }

  /* Re-render a step without the page moving.

     Holds the scroll offset across a re-render, undoing anything incidental
     that moved it (a focus, the browser's scroll anchoring reacting to the
     content swap). That is all it does, deliberately.

     Two earlier attempts did more and were worse:
       • A min-height floor on #applySteps stopped the document shrinking,
         but paid for it with dead space between the last field and the Next
         button — hundreds of pixels on every shorter step, which is the bug
         this replaced.
       • Padding the section bottom to keep the scroll offset reachable added
         and released height on every step, which moved the page itself.

     What neither could fix is the honest case: at maximum scroll, when a tall
     step is replaced by a short one, the offset simply no longer exists. So
     don't fight it — restore only when the target is still reachable. The
     button sits right after the content, and the content is allowed to have
     its natural height. */
  function renderStable(render) {
    var y = window.pageYOffset;
    var result = (render || renderStep)();
    var max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    if (window.pageYOffset !== y && y <= max) scrollToY(y);
    return result;
  }

  function currencySymbol() {
    var code = state.answers.compCurrency || "INR";
    for (var i = 0; i < CURRENCIES.length; i++) {
      if (CURRENCIES[i].value === code) return CURRENCIES[i].symbol;
    }
    return "₹";
  }

  function groupDigits(v) {
    var d = digitsOnly(v);
    if (!d) return "";
    // en-IN grouping (1,20,000) when the amount is in rupees; plain
    // thousands otherwise. Number is safe here — d is digits only.
    var locale = (state.answers.compCurrency || "INR") === "INR" ? "en-IN" : "en-US";
    return Number(d).toLocaleString(locale);
  }

  function track(event, props) {
    if (window.posthog && typeof window.posthog.capture === "function") {
      try { window.posthog.capture(event, props || {}); } catch (e) {}
    }
  }

  function allFields() {
    var out = [];
    var s = steps();
    for (var i = 0; i < s.length; i++) {
      for (var f = 0; f < s[i].fields.length; f++) out.push(s[i].fields[f]);
    }
    return out;
  }

  /* Blank answer object for a role — every declared field plus the two
     companion keys the tags renderer needs. */
  function freshAnswers(role) {
    var a = { compCurrency: "INR" };
    for (var s = 0; s < role.steps.length; s++) {
      var fields = role.steps[s].fields;
      for (var i = 0; i < fields.length; i++) {
        var field = fields[i];
        if (field.type === "linklist") a[field.name] = [""];
        else if (field.type === "tags") {
          a[field.name] = [];
          a[field.name + "Other"] = "";
          a[field.name + "OtherOpen"] = false;
        } else a[field.name] = "";
      }
    }
    return a;
  }

  /* ── draft persistence — one key PER ROLE ─────────────────────────
     A single shared key would let opening the intern form silently wipe a
     half-finished designer application. */

  function draftKey() {
    return "attira.careers.draft." + (state.role ? state.role.id : "none");
  }

  /* Fingerprint of the current question set. If the spec changes shape
     under a saved draft — a field renamed, or reused with a different type —
     restoring it would put e.g. an array into a textarea and render
     "[object Object]" with no way to clear it. Mismatch ⇒ discard. */
  function specSignature() {
    var fields = allFields();
    var out = [];
    for (var i = 0; i < fields.length; i++) out.push(fields[i].name + ":" + fields[i].type);
    return out.join(",");
  }

  function saveDraft() {
    if (!state.role) return;
    try {
      window.sessionStorage.setItem(
        draftKey(),
        JSON.stringify({
          step: state.step, answers: state.answers, uploads: state.uploads,
          sig: specSignature(), savedAt: Date.now()
        })
      );
    } catch (e) { /* private mode / quota — the form still works in memory */ }
  }

  function loadDraft() {
    if (!state.role) return false;
    try {
      var raw = window.sessionStorage.getItem(draftKey());
      if (!raw) return false;
      var saved = JSON.parse(raw);
      if (!saved || typeof saved.answers !== "object") return false;
      if (saved.sig && saved.sig !== specSignature()) { clearDraft(); return false; }
      for (var k in state.answers) {
        if (Object.prototype.hasOwnProperty.call(saved.answers, k)) {
          state.answers[k] = saved.answers[k];
        }
      }
      // Repair shapes the renderers assume, in case the spec changed
      // since the draft was written.
      var fields = allFields();
      for (var i = 0; i < fields.length; i++) {
        var f = fields[i];
        if (f.type === "linklist") {
          if (!Array.isArray(state.answers[f.name]) || !state.answers[f.name].length) {
            state.answers[f.name] = [""];
          }
        } else if (f.type === "tags") {
          if (!Array.isArray(state.answers[f.name])) state.answers[f.name] = [];
        }
      }
      // The staged file itself outlives the tab, so a restored draft can
      // still name what's attached rather than saying just "Uploaded".
      if (saved.uploads && typeof saved.uploads === "object") state.uploads = saved.uploads;
      if (typeof saved.step === "number" && saved.step >= 0 && saved.step < total()) {
        state.step = saved.step;
      }
      return true;
    } catch (e) {
      return false; /* corrupt draft — start clean rather than break the form */
    }
  }

  function clearDraft() {
    try { window.sessionStorage.removeItem(draftKey()); } catch (e) {}
  }

  /* ── field helpers ──────────────────────────────────────────────── */

  function labelFor(field) {
    return typeof field.label === "function" ? field.label(state.answers) : field.label;
  }

  function isVisible(field) {
    return typeof field.showIf === "function" ? !!field.showIf(state.answers) : true;
  }

  function visibleFields(step) {
    var out = [];
    for (var i = 0; i < step.fields.length; i++) {
      if (isVisible(step.fields[i])) out.push(step.fields[i]);
    }
    return out;
  }

  /* ── renderers, keyed by field type ─────────────────────────────── */

  function fieldShell(field) {
    var wrap = el("div", "apply__field");
    wrap.setAttribute("data-field", field.name);

    var label = el("label", "apply__label");
    label.setAttribute("for", "f-" + field.name);
    label.appendChild(document.createTextNode(labelFor(field)));
    if (!field.required) label.appendChild(el("span", "apply__optional", " (optional)"));
    wrap.appendChild(label);

    if (field.help) wrap.appendChild(el("p", "apply__help", field.help));
    return wrap;
  }

  function attachError(wrap, field) {
    var err = el("p", "apply__error");
    err.id = "err-" + field.name;
    if (errors[field.name]) {
      err.textContent = errors[field.name];
    } else {
      err.hidden = true;
    }
    wrap.appendChild(err);
  }

  function baseInput(field, tag) {
    var input = document.createElement(tag || "input");
    input.id = "f-" + field.name;
    input.name = field.name;
    input.setAttribute("data-name", field.name);
    if (tag !== "textarea" && tag !== "select") input.type = field.type === "url" ? "url" : field.type;
    if (field.placeholder) input.placeholder = field.placeholder;
    if (field.autocomplete) input.setAttribute("autocomplete", field.autocomplete);
    // A hard maxlength attribute would silently truncate a word-limited
    // answer mid-sentence, so only apply it when there is no word limit.
    if (field.maxlength && !field.maxwords) input.setAttribute("maxlength", String(field.maxlength));
    if (errors[field.name]) {
      input.setAttribute("aria-invalid", "true");
      input.setAttribute("aria-describedby", "err-" + field.name);
    }
    return input;
  }

  function renderInput(field) {
    var wrap = fieldShell(field);
    var input = baseInput(field);
    input.value = state.answers[field.name] || "";
    wrap.appendChild(input);
    attachError(wrap, field);
    return wrap;
  }

  /* Counter text for a textarea — words when the field is word-limited
     (the intern's 150-word pitch), characters otherwise. */
  function counterText(field, value) {
    var v = value || "";
    if (field.maxwords) return SPEC.countWords(v) + " / " + field.maxwords + " words";
    return v.length + " / " + field.maxlength;
  }

  function renderTextarea(field) {
    var wrap = fieldShell(field);
    var ta = baseInput(field, "textarea");
    ta.rows = field.rows || 6;
    ta.value = state.answers[field.name] || "";
    wrap.appendChild(ta);
    if (field.maxlength || field.maxwords) {
      var counter = el("p", "apply__counter");
      counter.setAttribute("data-counter-for", field.name);
      counter.textContent = counterText(field, state.answers[field.name]);
      if (field.maxwords && SPEC.countWords(state.answers[field.name]) > field.maxwords) {
        counter.className = "apply__counter is-over";
      }
      wrap.appendChild(counter);
    }
    attachError(wrap, field);
    return wrap;
  }

  function renderSelect(field) {
    var wrap = fieldShell(field);
    var sel = baseInput(field, "select");
    var placeholder = el("option", null, field.placeholder || "Select…");
    placeholder.value = "";
    sel.appendChild(placeholder);
    for (var i = 0; i < field.options.length; i++) {
      var o = field.options[i];
      var opt = el("option", null, o.label);
      opt.value = o.value;
      sel.appendChild(opt);
    }
    sel.value = state.answers[field.name] || "";
    wrap.appendChild(sel);
    attachError(wrap, field);
    return wrap;
  }

  function renderTags(field) {
    var wrap = fieldShell(field);
    var otherName = field.name + "Other";
    var selected = state.answers[field.name] || [];

    var group = el("div", "apply__tags");
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", labelFor(field));

    for (var i = 0; i < field.options.length; i++) {
      var name = field.options[i];
      var on = selected.indexOf(name) !== -1;
      var chip = el("button", "apply__tag" + (on ? " is-on" : ""), name);
      chip.type = "button";
      chip.setAttribute("data-tag", name);
      chip.setAttribute("data-tag-field", field.name);
      chip.setAttribute("aria-pressed", on ? "true" : "false");
      group.appendChild(chip);
    }

    var otherOpen = state.answers[otherName + "Open"] || !!trim(state.answers[otherName]);
    var otherChip = el("button", "apply__tag apply__tag--other" + (otherOpen ? " is-on" : ""),
      otherOpen ? "− Other" : "+ Other");
    otherChip.type = "button";
    otherChip.setAttribute("data-tag-other", field.name);
    otherChip.setAttribute("aria-expanded", otherOpen ? "true" : "false");
    group.appendChild(otherChip);

    wrap.appendChild(group);

    if (otherOpen) {
      var other = el("input", "apply__tag-input");
      other.type = "text";
      other.id = "f-" + otherName;
      other.setAttribute("data-name", otherName);
      other.setAttribute("maxlength", "200");
      other.placeholder = "Anything else — separate with commas";
      other.value = state.answers[otherName] || "";
      wrap.appendChild(other);
    }

    attachError(wrap, field);
    return wrap;
  }

  function renderCurrency(field) {
    var wrap = fieldShell(field);
    var row = el("div", "apply__currency");

    var sel = el("select", "apply__currency-select");
    sel.setAttribute("data-name", "compCurrency");
    sel.setAttribute("aria-label", "Currency");
    for (var i = 0; i < CURRENCIES.length; i++) {
      var opt = el("option", null, CURRENCIES[i].label);
      opt.value = CURRENCIES[i].value;
      sel.appendChild(opt);
    }
    sel.value = state.answers.compCurrency || "INR";
    row.appendChild(sel);

    // type="text" + inputmode, not type="number": number inputs give us
    // spinners, an empty .value for anything non-numeric, and locale-
    // dependent decimal handling we don't want for whole-rupee amounts.
    var input = el("input", "apply__currency-input");
    input.type = "text";
    input.id = "f-" + field.name;
    input.setAttribute("data-name", field.name);
    input.setAttribute("data-currency", "1");
    input.setAttribute("inputmode", "numeric");
    input.setAttribute("autocomplete", "off");
    input.placeholder = currencySymbol() + " per month";
    input.value = groupDigits(state.answers[field.name]);
    if (errors[field.name]) {
      input.setAttribute("aria-invalid", "true");
      input.setAttribute("aria-describedby", "err-" + field.name);
    }
    row.appendChild(input);

    wrap.appendChild(row);
    attachError(wrap, field);
    return wrap;
  }

  function renderLinkList(field) {
    var wrap = fieldShell(field);
    var max = field.maxItems || MAX_LINKS;
    var links = state.answers[field.name] || [""];
    var list = el("div", "apply__links");

    for (var i = 0; i < links.length; i++) {
      var row = el("div", "apply__link-row");
      var input = el("input", "apply__link-input");
      input.type = "url";
      input.setAttribute("data-name", field.name);
      input.setAttribute("data-index", String(i));
      input.placeholder = field.placeholder || "https://…";
      input.value = links[i] || "";
      if (i === 0) input.id = "f-" + field.name;
      if (errors[field.name]) input.setAttribute("aria-describedby", "err-" + field.name);
      row.appendChild(input);

      if (links.length > 1) {
        var rm = el("button", "apply__link-remove", "×");
        rm.type = "button";
        rm.setAttribute("data-link-remove", String(i));
        rm.setAttribute("data-link-field", field.name);
        rm.setAttribute("aria-label", "Remove link " + (i + 1));
        row.appendChild(rm);
      }
      list.appendChild(row);
    }

    wrap.appendChild(list);

    if (links.length < max) {
      var add = el("button", "apply__link-add", "+ Add another link");
      add.type = "button";
      add.setAttribute("data-link-add", field.name);
      wrap.appendChild(add);
    }

    attachError(wrap, field);
    return wrap;
  }

  /* ── file upload ──────────────────────────────────────────────────
     The file goes up the moment it's chosen rather than on submit: the
     apply payload is JSON capped at 64kb so it cannot carry the bytes,
     and discovering at the end that an 8MB scan won't send — after
     typing every other answer — is the worst possible time to find out.

     What's stored is only the opaque key the server returns. That keeps
     state.answers serialisable into the sessionStorage draft, which a
     File object is not. */

  function prettyBytes(n) {
    if (!n) return "";
    return n < 1024 * 1024
      ? Math.max(1, Math.round(n / 1024)) + " KB"
      : (n / (1024 * 1024)).toFixed(1) + " MB";
  }

  function renderFile(field) {
    var wrap = fieldShell(field);
    var token = trim(state.answers[field.name]);
    var meta = state.uploads[field.name] || {};

    var input = document.createElement("input");
    input.type = "file";
    input.id = "f-" + field.name;
    input.className = "apply__file";
    input.setAttribute("data-file", field.name);
    if (field.accept) input.setAttribute("accept", field.accept);
    if (errors[field.name]) {
      input.setAttribute("aria-invalid", "true");
      input.setAttribute("aria-describedby", "err-" + field.name);
    }
    wrap.appendChild(input);

    var status = el("p", "apply__file-status");
    status.setAttribute("data-file-status", field.name);
    // aria-live so a screen reader hears the upload finish; the visual
    // equivalent is the filename appearing under the control.
    status.setAttribute("aria-live", "polite");
    if (state.uploading[field.name]) {
      status.textContent = "Uploading…";
    } else if (token) {
      status.textContent = "Attached: " + (meta.filename || "your file") +
        (meta.bytes ? " · " + prettyBytes(meta.bytes) : "");
      var remove = el("button", "apply__file-remove", "Remove");
      remove.type = "button";
      remove.setAttribute("data-file-remove", field.name);
      status.appendChild(document.createTextNode(" "));
      status.appendChild(remove);
    } else {
      status.hidden = true;
    }
    wrap.appendChild(status);

    attachError(wrap, field);
    return wrap;
  }

  function uploadFile(name, file) {
    var field = fieldByName(name);
    if (field && field.maxBytes && file.size > field.maxBytes) {
      errors[name] = "That file is " + prettyBytes(file.size) +
        " — please upload one under " + prettyBytes(field.maxBytes) + ", or paste a link instead.";
      renderStable();
      return;
    }

    state.uploading[name] = true;
    delete errors[name];
    renderStable();

    var body = new FormData();
    body.append("file", file, file.name);

    fetch("/api/careers/upload", { method: "POST", body: body })
      .then(function (res) {
        return res.json().then(function (data) { return { ok: res.ok, data: data }; });
      })
      .then(function (result) {
        if (!result.ok || !result.data || !result.data.ok) {
          errors[name] = (result.data && result.data.error) ||
            "We couldn't upload that. You can paste a link to it instead.";
          track("career_resume_upload_failed", { reason: errors[name] });
          return;
        }
        state.uploads[name] = { filename: result.data.filename, bytes: result.data.bytes };
        setAnswer(name, result.data.token);
        track("career_resume_uploaded", { bytes: result.data.bytes });
      })
      .catch(function () {
        errors[name] = "Upload failed — check your connection, or paste a link instead.";
      })
      .finally(function () {
        state.uploading[name] = false;
        saveDraft();
        renderStable();
      });
  }

  var RENDERERS = {
    text: renderInput,
    email: renderInput,
    tel: renderInput,
    url: renderInput,
    textarea: renderTextarea,
    select: renderSelect,
    tags: renderTags,
    currency: renderCurrency,
    linklist: renderLinkList,
    file: renderFile
  };

  /* ── review step ────────────────────────────────────────────────── */

  function displayValue(field) {
    var v = state.answers[field.name];
    if (field.type === "linklist") {
      return (v || []).filter(function (x) { return trim(x); }).join("\n");
    }
    if (field.type === "tags") {
      var parts = (v || []).slice();
      var other = trim(state.answers[field.name + "Other"]);
      if (other) parts.push(other);
      return parts.join(", ");
    }
    if (field.type === "currency") {
      var d = groupDigits(v);
      return d ? currencySymbol() + " " + d + " / month" : "";
    }
    if (field.type === "select") {
      for (var i = 0; i < field.options.length; i++) {
        if (field.options[i].value === v) return field.options[i].label;
      }
      return "";
    }
    // The stored value is an upload key, which means nothing to a human.
    if (field.type === "file") {
      if (!trim(v)) return "";
      var meta = state.uploads[field.name] || {};
      return meta.filename ? meta.filename + " (uploaded)" : "Uploaded";
    }
    return trim(v);
  }

  function renderReview() {
    var box = el("div", "apply__review");
    var s = steps();
    for (var i = 0; i < s.length; i++) {
      if (s[i].review) continue;
      var fields = visibleFields(s[i]);
      for (var f = 0; f < fields.length; f++) {
        var field = fields[f];
        var value = displayValue(field);
        var row = el("div", "apply__review-row");
        row.appendChild(el("p", "apply__review-label", labelFor(field)));
        row.appendChild(el("p", "apply__review-value", value || "—"));
        var edit = el("button", "apply__review-edit", "Edit");
        edit.type = "button";
        edit.setAttribute("data-goto", String(i));
        edit.setAttribute("aria-label", "Edit: " + labelFor(field));
        row.appendChild(edit);
        box.appendChild(row);
      }
    }
    return box;
  }

  /* ── rendering a step ───────────────────────────────────────────── */

  function renderStep() {
    var step = steps()[state.step];
    if (!step) return null;
    elSteps.innerHTML = "";

    var wrap = el("div", "apply__step");
    wrap.setAttribute("role", "group");
    wrap.setAttribute("tabindex", "-1");
    wrap.id = "step-" + step.id;
    wrap.setAttribute("aria-labelledby", "step-title-" + step.id);

    var title = el("h3", "apply__step-title", step.title);
    title.id = "step-title-" + step.id;
    wrap.appendChild(title);

    if (step.hint) wrap.appendChild(el("p", "apply__step-hint", step.hint));
    if (step.context) wrap.appendChild(el("p", "apply__context", step.context));

    if (step.review) {
      wrap.appendChild(renderReview());
    } else {
      var fields = visibleFields(step);
      for (var i = 0; i < fields.length; i++) {
        var render = RENDERERS[fields[i].type];
        if (render) wrap.appendChild(render(fields[i]));
      }
    }

    elSteps.appendChild(wrap);

    elBack.hidden = state.step === 0;
    elNext.hidden = !!step.review;
    elSubmit.hidden = !step.review;
    if (elSkip) elSkip.hidden = !step.skippable || !!step.review;

    renderProgress();
    return wrap;
  }

  function renderProgress() {
    var n = total();
    var pct = ((state.step + 1) / n) * 100;
    elProgressFill.style.width = pct + "%";
    elProgress.setAttribute("aria-valuenow", String(state.step + 1));
    elProgress.setAttribute("aria-valuemax", String(n));
    elProgressCount.textContent =
      "Step " + (state.step + 1) + " of " + n + " · " + steps()[state.step].title;
  }

  /* ── validation — delegated to the shared spec ──────────────────── */

  function validateStep(index) {
    var step = steps()[index === undefined ? state.step : index];
    var fields = visibleFields(step);
    var found = {};
    for (var i = 0; i < fields.length; i++) {
      var msg = SPEC.validateField(fields[i], state.answers[fields[i].name], state.answers);
      if (msg) found[fields[i].name] = msg;
    }
    return found;
  }

  function showMsg(text, kind) {
    elMsg.textContent = text || "";
    elMsg.className = "apply__msg" + (kind ? " is-" + kind : "");
  }

  /* ── navigation ─────────────────────────────────────────────────
     Step changes must NOT move the page. Three things used to move it:
       1. the browser scrolling a newly focused element into view,
       2. an explicit scrollIntoView on the progress bar — and because that
          bar sits at the TOP of the card, it yanked the page upward
          whenever the user was reading a field below it,
       3. the document shrinking under a scrolled-to-the-bottom viewport.
     (1) is handled by focusNoScroll, (2) is deleted outright, (3) by
     renderStable(). */

  function goTo(index) {
    if (index < 0 || index >= total()) return;
    state.step = index;
    errors = {};
    showMsg("");
    var stepEl = renderStable();
    saveDraft();
    focusNoScroll(stepEl);
  }

  function next() {
    var found = validateStep();
    var names = Object.keys(found);
    if (names.length) {
      errors = found;
      renderStable();
      var first = elSteps.querySelector('[data-field="' + names[0] + '"]');
      var focusable = first && first.querySelector("input, select, textarea, button");
      focusNoScroll(focusable);
      /* block:"nearest" is a no-op when the field is already fully visible,
         so this moves nothing in the normal case. It exists only so that on
         a short screen, where the failing field is genuinely off-screen,
         pressing Next doesn't appear to do nothing at all. */
      if (focusable && focusable.scrollIntoView) focusable.scrollIntoView({ block: "nearest" });
      showMsg("Please fix the highlighted field" + (names.length > 1 ? "s" : "") + " to continue.", "err");
      track("career_step_invalid", {
        role: state.role.id, step: state.step + 1, step_id: steps()[state.step].id, fields: names
      });
      return;
    }
    track("career_step_completed", {
      role: state.role.id, step: state.step + 1, step_id: steps()[state.step].id
    });
    goTo(state.step + 1);
  }

  /* Back never validates — a half-finished answer must survive going
     backwards, which is the whole point of holding state in JS. */
  function back() {
    goTo(state.step - 1);
  }

  /* Skip clears the step before moving on, so "skipped" means skipped: the
     review summary shows "—" and no half-answer reaches the database. The
     fields are optional in the spec, so the server accepts the gap too. */
  function skip() {
    var step = steps()[state.step];
    if (!step || !step.skippable) return;
    for (var i = 0; i < step.fields.length; i++) {
      var f = step.fields[i];
      if (f.type === "linklist") state.answers[f.name] = [""];
      else if (f.type === "tags") {
        state.answers[f.name] = [];
        state.answers[f.name + "Other"] = "";
        state.answers[f.name + "OtherOpen"] = false;
      } else state.answers[f.name] = "";
      delete errors[f.name];
    }
    track("career_step_skipped", {
      role: state.role.id, step: state.step + 1, step_id: step.id
    });
    goTo(state.step + 1);
  }

  /* ── submit ─────────────────────────────────────────────────────── */

  function readUtm() {
    var out = {};
    try {
      var params = new URLSearchParams(window.location.search);
      var keys = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"];
      for (var i = 0; i < keys.length; i++) {
        var v = params.get(keys[i]);
        if (v) out[keys[i]] = v.slice(0, 200);
      }
    } catch (e) {}
    return out;
  }

  /* One normalised value per declared field, so the server can walk the
     same spec to read it. Nothing outside the spec is ever sent. */
  function buildPayload() {
    var fields = allFields();
    var out = {};
    for (var i = 0; i < fields.length; i++) {
      var f = fields[i];
      var v = state.answers[f.name];
      if (f.type === "linklist") {
        out[f.name] = (v || []).map(trim).filter(Boolean);
      } else if (f.type === "tags") {
        out[f.name] = v || [];
        out[f.name + "Other"] = trim(state.answers[f.name + "Other"]);
      } else if (f.type === "currency") {
        out[f.name] = digitsOnly(v);
      } else if (f.type === "tel") {
        out[f.name] = normalizePhone(v);
      } else if (f.type === "email") {
        out[f.name] = trim(v).toLowerCase();
      } else {
        out[f.name] = trim(v);
      }
    }
    out.compCurrency = state.answers.compCurrency || "INR";
    return { role: state.role.id, fields: out, utm: readUtm() };
  }

  function submit() {
    if (state.submitting) return;

    // Re-check every step, not just the review step — a draft restored from
    // an older version of the spec could be missing a now-required field.
    var origin = state.step;
    for (var i = 0; i < total(); i++) {
      var found = validateStep(i);
      if (Object.keys(found).length) {
        state.step = i;
        errors = found;
        renderStable();
        showMsg("Something's missing on “" + steps()[i].title + "”. We've taken you back to it.", "err");
        saveDraft();
        return;
      }
    }
    state.step = origin;

    state.submitting = true;
    elSubmit.disabled = true;
    elBack.disabled = true;
    showMsg("Sending your application…");

    fetch("/api/careers/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildPayload())
    })
      .then(function (res) {
        return res.json().then(function (data) { return { ok: res.ok, data: data }; });
      })
      .then(function (result) {
        if (!result.ok || !result.data || !result.data.ok) {
          var message = (result.data && result.data.error) ||
            "We couldn't send that. Please try again in a moment.";
          showMsg(message, "err");
          track("career_application_failed", { role: state.role.id, reason: message });
          return;
        }
        state.done = true;
        clearDraft();
        form.hidden = true;
        // The progress bar describes a form that no longer exists — hide the
        // whole header so the confirmation stands on its own.
        if (elHead) elHead.hidden = true;
        elDone.hidden = false;
        if (elDoneRef) elDoneRef.textContent = result.data.ref || "—";
        if (elDoneRole) elDoneRole.textContent = state.role.title;
        elDone.setAttribute("tabindex", "-1");
        focusNoScroll(elDone);
        if (elDone.scrollIntoView) elDone.scrollIntoView({ block: "center" });
        track("career_application_submitted", { role: state.role.id, ref: result.data.ref });
      })
      .catch(function (err) {
        showMsg("Network error — your answers are safe. Check your connection and try again.", "err");
        track("career_application_failed", { role: state.role.id, reason: (err && err.message) || "network" });
      })
      .finally(function () {
        state.submitting = false;
        elSubmit.disabled = false;
        elBack.disabled = false;
      });
  }

  /* ── delegated event wiring (bound once; steps re-render freely) ── */

  function setAnswer(name, value) {
    state.answers[name] = value;
    if (errors[name]) delete errors[name];
    saveDraft();
  }

  function fieldByName(name) {
    var fields = allFields();
    for (var i = 0; i < fields.length; i++) if (fields[i].name === name) return fields[i];
    return null;
  }

  elSteps.addEventListener("input", function (e) {
    var t = e.target;
    var name = t.getAttribute && t.getAttribute("data-name");
    if (!name) return;

    var field = fieldByName(name);

    if (field && field.type === "linklist") {
      var idx = parseInt(t.getAttribute("data-index"), 10) || 0;
      var links = (state.answers[name] || []).slice();
      links[idx] = t.value;
      setAnswer(name, links);
      return;
    }

    if (t.getAttribute("data-currency")) {
      // Sanitise as they type, keeping the caret at the end (these fields are
      // short enough that mid-string editing isn't worth the complexity).
      var digits = digitsOnly(t.value);
      setAnswer(name, digits);
      t.value = groupDigits(digits);
      return;
    }

    setAnswer(name, t.value);

    var counter = elSteps.querySelector('[data-counter-for="' + name + '"]');
    if (counter && field) {
      counter.textContent = counterText(field, t.value);
      counter.className = "apply__counter" +
        (field.maxwords && SPEC.countWords(t.value) > field.maxwords ? " is-over" : "");
    }
  });

  elSteps.addEventListener("change", function (e) {
    var t = e.target;

    // File inputs carry data-file rather than data-name: their value is a
    // key from the server, never the control's own value.
    var fileName = t.getAttribute && t.getAttribute("data-file");
    if (fileName) {
      if (t.files && t.files[0]) uploadFile(fileName, t.files[0]);
      return;
    }

    var name = t.getAttribute && t.getAttribute("data-name");
    if (!name) return;
    if (name === "compCurrency") {
      setAnswer("compCurrency", t.value);
      renderStable(); // both currency fields re-format together
      return;
    }
    if (t.tagName === "SELECT") setAnswer(name, t.value);
  });

  /* focusout (not blur — blur doesn't bubble) so we can tidy up URLs the
     moment someone leaves the field, rather than failing them on Next. */
  elSteps.addEventListener("focusout", function (e) {
    var t = e.target;
    var name = t.getAttribute && t.getAttribute("data-name");
    if (!name || t.type !== "url") return;
    var v = trim(t.value);
    if (v && !/^https?:\/\//i.test(v) && /\./.test(v)) {
      var fixed = "https://" + v;
      t.value = fixed;
      var field = fieldByName(name);
      if (field && field.type === "linklist") {
        var idx = parseInt(t.getAttribute("data-index"), 10) || 0;
        var links = (state.answers[name] || []).slice();
        links[idx] = fixed;
        setAnswer(name, links);
      } else {
        setAnswer(name, fixed);
      }
    }
  });

  elSteps.addEventListener("click", function (e) {
    var t = e.target;
    if (!t || !t.getAttribute) return;

    /* Removing an attachment only forgets the key — the staged object is
       left for the bucket's lifecycle rule to clear, since nothing else
       can reach it. */
    var removeFile = t.getAttribute("data-file-remove");
    if (removeFile) {
      delete state.uploads[removeFile];
      setAnswer(removeFile, "");
      renderStable();
      focusNoScroll(document.getElementById("f-" + removeFile));
      return;
    }

    var tag = t.getAttribute("data-tag");
    var tagField = t.getAttribute("data-tag-field");
    if (tag && tagField) {
      var picked = (state.answers[tagField] || []).slice();
      var at = picked.indexOf(tag);
      if (at === -1) picked.push(tag); else picked.splice(at, 1);
      setAnswer(tagField, picked);
      renderStable();
      return;
    }

    var otherFor = t.getAttribute("data-tag-other");
    if (otherFor) {
      var otherName = otherFor + "Other";
      var open = !(state.answers[otherName + "Open"] || trim(state.answers[otherName]));
      state.answers[otherName + "Open"] = open;
      if (!open) state.answers[otherName] = "";
      if (errors[otherFor]) delete errors[otherFor];
      saveDraft();
      renderStable();
      focusNoScroll(document.getElementById("f-" + otherName));
      return;
    }

    var addFor = t.getAttribute("data-link-add");
    if (addFor) {
      var addField = fieldByName(addFor);
      var cap = (addField && addField.maxItems) || MAX_LINKS;
      var list = (state.answers[addFor] || []).slice();
      if (list.length < cap) list.push("");
      setAnswer(addFor, list);
      renderStable();
      var inputs = elSteps.querySelectorAll(".apply__link-input");
      if (inputs.length) focusNoScroll(inputs[inputs.length - 1]);
      return;
    }

    var removeAt = t.getAttribute("data-link-remove");
    var removeFor = t.getAttribute("data-link-field");
    if (removeAt !== null && removeFor) {
      var rest = (state.answers[removeFor] || []).slice();
      rest.splice(parseInt(removeAt, 10), 1);
      if (!rest.length) rest = [""];
      setAnswer(removeFor, rest);
      renderStable();
      return;
    }

    var goto = t.getAttribute("data-goto");
    if (goto !== null) goTo(parseInt(goto, 10));
  });

  /* Enter inside a single-line field means "next", not "submit" — without
     this the browser fires submit from step 1. */
  form.addEventListener("keydown", function (e) {
    if (e.key !== "Enter") return;
    var t = e.target;
    if (!t || t.tagName === "TEXTAREA" || t.tagName === "BUTTON") return;
    e.preventDefault();
    if (!steps()[state.step].review) next();
  });

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    submit();
  });

  elNext.addEventListener("click", next);
  elBack.addEventListener("click", back);
  if (elSkip) elSkip.addEventListener("click", skip);

  /* ── opening a role's form ──────────────────────────────────────── */

  function markOpenButtons(roleId) {
    var btns = document.querySelectorAll("[data-role-apply]");
    for (var i = 0; i < btns.length; i++) {
      btns[i].setAttribute("aria-expanded",
        btns[i].getAttribute("data-role-apply") === roleId ? "true" : "false");
    }
  }

  function openForm(roleId, fromClick) {
    var role = SPEC.findRole(roleId);
    if (!role) return;
    var switching = !state.role || state.role.id !== roleId;

    /* Undo whatever the success panel left behind — unconditionally, not
       only when switching. Re-opening the SAME role after submitting it
       would otherwise reveal a dead confirmation panel with no form. */
    if (state.done || form.hidden) {
      state.done = false;
      form.hidden = false;
      elDone.hidden = true;
      if (elHead) elHead.hidden = false;
      if (!switching) {                 // resubmitting the same role: start fresh
        state.step = 0;
        state.answers = freshAnswers(role);
      state.uploads = {};
      state.uploading = {};
        renderStep();
        showMsg("");
      }
    }

    if (switching) {
      state.role = role;
      state.step = 0;
      state.answers = freshAnswers(role);
      state.uploads = {};
      state.uploading = {};
      var restored = loadDraft();

      if (elTitle) elTitle.textContent = "Apply — " + role.title;
      renderStep();
      if (restored && state.step > 0) {
        showMsg("We kept your answers from earlier — pick up where you left off.", "ok");
      } else {
        showMsg("");
      }
    }

    elApply.hidden = false;
    markOpenButtons(roleId);

    if (fromClick) {
      writeRoleToUrl(roleId);
      if (elApply.scrollIntoView) elApply.scrollIntoView({ behavior: "smooth", block: "start" });
      // After the scroll call, not before — on iOS a focus scroll started
      // first fights the in-flight smooth animation and lands arbitrarily.
      focusNoScroll(elSteps.querySelector("input, select, textarea"));
    }
    track("career_apply_opened", { role: roleId });
  }

  var applyButtons = document.querySelectorAll("[data-role-apply]");
  for (var b = 0; b < applyButtons.length; b++) {
    applyButtons[b].addEventListener("click", function () {
      openForm(this.getAttribute("data-role-apply"), true);
    });
  }

  /* ── collapsible job descriptions ─────────────────────────────────
     The markup ships EXPANDED and is collapsed here, the same
     progressive-enhancement shape as script.js's reveal system. That way a
     visitor without JS reads all three descriptions in full rather than
     three headlines and nothing else — which matters because the #applyNoJs
     fallback is removed the moment this file runs. It also means the full
     text is unambiguously present for crawlers on first paint. */

  var jdToggles = document.querySelectorAll("[data-jd-toggle]");

  function setJd(btn, open) {
    var panel = document.getElementById(btn.getAttribute("data-jd-toggle"));
    if (!panel) return;
    if (open) panel.removeAttribute("hidden"); else panel.setAttribute("hidden", "");
    btn.setAttribute("aria-expanded", open ? "true" : "false");
    btn.textContent = open ? "Hide description" : "Read the full description";
  }

  for (var j = 0; j < jdToggles.length; j++) {
    setJd(jdToggles[j], false);          // collapse now that JS is confirmed
    jdToggles[j].addEventListener("click", function () {
      var open = this.getAttribute("aria-expanded") !== "true";
      /* Anchor the clicked button. Unlike the step-change case this
         correction genuinely works: collapsing a card pulls the cards below
         it upward, so the scroll position we need still exists. */
      var before = this.getBoundingClientRect().top;
      setJd(this, open);
      scrollByDelta(this.getBoundingClientRect().top - before);
      track("career_jd_toggled", {
        role: this.getAttribute("data-jd-toggle").replace(/^jd-/, ""), open: open
      });
    });
  }

  /* ── init ───────────────────────────────────────────────────────── */

  if (elNoJs && elNoJs.parentNode) elNoJs.parentNode.removeChild(elNoJs);

  /* Deep links. ?role=<id> is the canonical form — Google strips fragments
     when normalising URLs, so a query param is what lets each JobPosting in
     the JSON-LD carry a distinct `url`, and it survives being pasted into
     tools that drop the fragment. #apply-<id> is accepted as an alias, and
     bare #apply still opens the first role so anything shared earlier keeps
     working. */
  function writeRoleToUrl(id) {
    try {
      var p = new URLSearchParams(window.location.search);
      p.set("role", id);
      window.history.replaceState(null, "", window.location.pathname + "?" + p.toString() + "#apply");
    } catch (e) {}
  }

  function roleFromUrl() {
    try {
      var q = new URLSearchParams(window.location.search).get("role");
      if (q && SPEC.findRole(q)) return q;
    } catch (e) {}
    var h = window.location.hash || "";
    if (h === "#apply") return SPEC.ROLES[0].id;
    var m = /^#apply-(.+)$/.exec(h);
    return m && SPEC.findRole(m[1]) ? m[1] : null;
  }

  /* Reopen whichever role has a draft in progress, so a reload doesn't look
     like the answers were lost. If more than one role has one, the most
     recently saved wins. */
  function roleWithDraft() {
    var best = null, bestAt = -1;
    for (var i = 0; i < SPEC.ROLES.length; i++) {
      try {
        var raw = window.sessionStorage.getItem("attira.careers.draft." + SPEC.ROLES[i].id);
        if (!raw) continue;
        var at = (JSON.parse(raw) || {}).savedAt || 0;
        if (at >= bestAt) { bestAt = at; best = SPEC.ROLES[i].id; }
      } catch (e) { /* unreadable draft — just skip it */ }
    }
    return best;
  }

  var initial = roleFromUrl();
  var fromUrl = !!initial;
  if (!initial) initial = roleWithDraft();

  if (initial) {
    openForm(initial, false);
    if (fromUrl && elApply.scrollIntoView) elApply.scrollIntoView({ block: "start" });
  }
})();
