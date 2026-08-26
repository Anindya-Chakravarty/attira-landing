/* ===================================================================
   Attira — open roles + application question sets
   THE single source of truth for every careers form.

   This one file is loaded BOTH ways:
     • the browser gets it as <script src>  → window.ATTIRA_CAREERS
     • server.js gets it via require()      → module.exports

   That is deliberate. Keeping field names, required flags, option
   allowlists and format rules in two places guarantees they drift — and a
   client/server mismatch is exactly the failure that rejects an applicant
   AFTER they've filled in ten other fields. validateField() below is the
   shared referee: the form and the API reach the same verdict because they
   run the same code.

   Plain ES5, no build step (matches queue.js / status.js / careers.js).

   Adding a role = adding an entry to ROLES. No schema change is needed —
   careers-db.js stores role-specific answers as JSON.

   NOTE: this file is served publicly by express.static. Nothing secret.
   =================================================================== */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ATTIRA_CAREERS = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* ── shared format rules ─────────────────────────────────────────
     EMAIL_RE is byte-identical to script.js:235 and server.js's copy —
     a looser client regex just means a confusing late rejection. */
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  var URL_RE = /^https?:\/\/[^\s.]+\.[^\s]{2,}$/i;
  var PHONE_RE = /^\+?[0-9]{7,15}$/;

  var MAX_LINKS = 4;

  function trimStr(v) {
    return typeof v === "string" ? v.trim() : "";
  }

  /* Deliberately permissive: international numbers vary far too much to
     pattern-match safely, and rejecting a real applicant's number is a
     much worse outcome than storing a slightly odd one. */
  function normalizePhone(v) {
    return trimStr(v).replace(/[\s()\-.]/g, "");
  }

  function digitsOnly(v) {
    return String(v == null ? "" : v).replace(/[^\d]/g, "");
  }

  function countWords(v) {
    var t = trimStr(v);
    return t ? t.split(/\s+/).length : 0;
  }

  /* ── option lists ────────────────────────────────────────────────── */

  var YEARS_OPTIONS = [
    { value: "0-1", label: "Under 2 years" },
    { value: "2-3", label: "2–3 years" },
    { value: "4-6", label: "4–6 years" },
    { value: "7-10", label: "7–10 years" },
    { value: "10+", label: "10+ years" }
  ];

  /* Design + social production tools, per the Content & Design Lead JD
     ("Figma or Canva to a professional standard", video editing a
     nice-to-have). */
  var LEAD_TOOLS = [
    "Figma", "Canva", "Photoshop", "Illustrator", "InDesign",
    "After Effects", "Premiere Pro", "CapCut", "Lightroom",
    "Meta Business Suite", "Later", "Buffer", "Notion"
  ];

  var ASSOCIATE_TOOLS = [
    "Canva", "Figma", "CapCut", "Premiere Pro", "After Effects",
    "Lightroom", "Photoshop", "VN", "InShot", "Notion"
  ];

  /* No mid-course student option: this is a full-time seat, so someone who
     isn't graduating shortly can't take it. */
  var STATUS_OPTIONS = [
    { value: "final-year", label: "Final-year student, graduating soon" },
    { value: "graduate", label: "Recent graduate" },
    { value: "switcher", label: "Career switcher" },
    { value: "working", label: "Currently working" }
  ];

  var NOTICE_OPTIONS = [
    { value: "immediately", label: "Immediately" },
    { value: "2-weeks", label: "Within 2 weeks" },
    { value: "1-month", label: "1 month" },
    { value: "2-months", label: "2 months" },
    { value: "3-months-plus", label: "3 months or more" }
  ];

  var CURRENCIES = [
    { value: "INR", label: "₹ INR", symbol: "₹" },
    { value: "USD", label: "$ USD", symbol: "$" }
  ];

  /* ── shared field fragments ──────────────────────────────────────
     Both roles open with the same identity questions, so they are built
     once here rather than copy-pasted. */

  function nameField() {
    return {
      name: "fullName", type: "text", label: "Your name", required: true,
      placeholder: "Riya Sharma", autocomplete: "name", maxlength: 120
    };
  }

  function emailField() {
    return {
      name: "email", type: "email", label: "Email", required: true,
      placeholder: "you@example.com", autocomplete: "email", maxlength: 254
    };
  }

  function phoneField() {
    return {
      name: "phone", type: "tel", label: "Phone number", required: true,
      placeholder: "+91 98765 43210", autocomplete: "tel",
      help: "Include your country code if you're outside India."
    };
  }

  function locationField() {
    return {
      name: "location", type: "text", label: "Where are you based?", required: true,
      placeholder: "New Delhi, India", autocomplete: "address-level2", maxlength: 120
    };
  }

  /* ── the resume: upload OR link ───────────────────────────────────
     Two ways to answer one question, deliberately. Most people applying
     for these roles arrive on a phone inside the Instagram in-app
     browser, where a file picker is awkward and sometimes unavailable —
     and a pasted link is what every applicant so far has actually used.
     The pair is validated together: when `required`, one of the two must
     be filled, and the message lands on the upload because a real file
     is the outcome we'd rather have. */
  function resumeFields(required) {
    return [
      {
        name: "resumeUrl", type: "url", label: "Link to your resume",
        placeholder: "https://drive.google.com/…",
        help: required
          ? "Paste a link or upload the file below — either works. If you link it, please set sharing to anyone-with-the-link."
          : "Optional — the portfolio matters more. If you link it, make sure it's shared with anyone-with-the-link."
      },
      {
        name: "resumeFile", type: "file", label: "…or upload it here",
        required: !!required, requiredUnless: "resumeUrl",
        accept: ".pdf,.doc,.docx,image/*", maxBytes: 10 * 1024 * 1024,
        help: "PDF, Word doc, or a clear photo of it. Up to 10MB.",
        emptyMessage: "Upload your resume, or paste a link to it above."
      }
    ];
  }

  function anythingElseField() {
    return {
      name: "anythingElse", type: "textarea", rows: 5, maxlength: 5000,
      label: "Anything else you'd like us to know?",
      help: "Optional.",
      placeholder: "Notice period, availability, a thing you're proud of that didn't fit above…"
    };
  }

  function reviewStep() {
    return { id: "review", title: "Review", hint: "Check it over, then send.", review: true, fields: [] };
  }

  /* ── ROLE 1 — Content & Design Lead ───────────────────────────────
     Question set mirrors the JD's "How we'll assess you" section: three
     pieces of design work with their briefs, one account they ran with
     before/after, and one post that underperformed. */

  var LEAD_STEPS = [
    {
      id: "about", title: "About you",
      hint: "Two quick things, then we'll get to the work.",
      fields: [nameField(), emailField()]
    },
    {
      id: "reaching-you", title: "Reaching you",
      hint: "So we can actually get hold of you.",
      fields: [phoneField(), locationField()]
    },
    {
      id: "experience", title: "Your experience",
      hint: "We care about the portfolio more than the CV — this is just the frame around it.",
      fields: [
        {
          name: "yearsExperience", type: "select", required: true,
          label: "Years running social for a consumer brand",
          placeholder: "Select a range…", options: YEARS_OPTIONS,
          help: "In-house or agency both count."
        },
        {
          name: "portfolioUrl", type: "url", label: "Portfolio link", required: true,
          placeholder: "https://yourname.com", autocomplete: "url",
          help: "Personal site, Behance, Dribbble, Notion, a Drive folder — wherever the work lives."
        }
      ]
    },
    {
      id: "design-work", title: "Three pieces of design work",
      context: "We will ask to see the files, not just the exports.",
      fields: [
        {
          name: "workSamples", type: "linklist", required: true, maxItems: MAX_LINKS,
          csvLabel: "Design work links",
          label: "Links to 2-3 pieces you made end to end",
          help: "Add up to " + MAX_LINKS + ". Please check anything gated is set to view-only public.",
          placeholder: "https://…"
        },
        {
          name: "designBriefs", type: "textarea", required: true, rows: 7, maxlength: 5000,
          label: "What was the brief for each?",
          placeholder: "For each piece: what you were asked for, what you decided, and what shipped.",
          help: "The brief is the interesting part — it's what tells us how you think, not just what you can make."
        }
      ]
    },
    {
      id: "account", title: "An account you ran",
      /* Skippable: plenty of strong designers have never owned a brand
         account, and making this a hard gate would lose them at step 5.
         `skippable` renders a Skip button; the fields are optional so the
         server accepts the step empty too. */
      skippable: true,
      hint: "If you've run one, this is the most useful thing you can tell us. If you haven't, skip it.",
      fields: [
        {
          name: "socialAccount", type: "text", maxlength: 200,
          label: "The handle",
          placeholder: "@theaccount — and the platform, if it isn't obvious"
        },
        {
          name: "accountResult", type: "textarea", rows: 6, maxlength: 5000,
          label: "What did it look like when you took it over, and when you left?",
          placeholder: "Followers, reach, posting cadence, whatever you actually moved. Numbers help.",
          help: "If you're still running it, tell us where it started and where it is now."
        }
      ]
    },
    {
      id: "underperformed", title: "Something that didn't work",
      context: "Everyone has posts that flop. We're interested in what you did about it.",
      fields: [
        {
          name: "underperformed", type: "textarea", required: true, rows: 5, maxlength: 2000,
          label: "One post of yours that underperformed — and what you concluded from it",
          placeholder: "Two lines is genuinely enough.",
          help: "No right answer. We're reading for whether you look at your own numbers honestly."
        }
      ]
    },
    {
      id: "tools", title: "Your toolkit",
      hint: "Pick everything you actually use, not everything you've opened.",
      fields: [
        {
          name: "tools", type: "tags", label: "What do you design and edit in?", required: true,
          options: LEAD_TOOLS,
          help: "Choose any that apply, and add anything we've missed under Other."
        }
      ]
    },
    {
      id: "compensation", title: "Compensation",
      hint: "We ask up front so neither of us wastes the other's time.",
      fields: [
        {
          name: "currentComp", type: "currency", label: "Current monthly compensation",
          required: true,
          /* Say "monthly" explicitly — comp bands in India are usually quoted
             annually, so without this people type the annual figure. */
          help: "Monthly, not annual. Enter 0 if you're between roles or currently studying."
        },
        {
          name: "expectedComp", type: "currency", label: "Expected monthly compensation",
          required: true, help: "Monthly, not annual."
        }
      ]
    },
    {
      id: "wrapping-up", title: "Wrapping up",
      fields: resumeFields(true).concat([anythingElseField()])
    },
    reviewStep()
  ];

  /* ── ROLE 2 — Design & Social Media Associate ─────────────────────
     Deliberately shorter than the Lead form. This is a full-time junior seat
     aimed at recent grads and career switchers; a long form costs you exactly
     the candidates the role is trying to reach. */

  var ASSOCIATE_STEPS = [
    {
      id: "about", title: "About you",
      hint: "Two quick things, then we'll get to the work.",
      fields: [nameField(), emailField()]
    },
    {
      id: "reaching-you", title: "Reaching you",
      hint: "So we can actually get hold of you.",
      fields: [phoneField(), locationField()]
    },
    {
      id: "where-youre-at", title: "Where you're at",
      fields: [
        {
          name: "currentStatus", type: "select", required: true,
          label: "Which of these fits you best right now?",
          placeholder: "Select one…", options: STATUS_OPTIONS
        },
        {
          name: "collegeOrg", type: "text", maxlength: 200,
          label: "College, or where you're working",
          placeholder: "Hindu College, Delhi University — BA Economics"
        }
      ]
    },
    {
      id: "portfolio", title: "Your portfolio",
      context: "Anything real counts — a college fest's Instagram, a friend's small business, your own page, coursework you're proud of.",
      fields: [
        {
          /* Deliberately `text`, not `url`: the JD explicitly accepts an
             Instagram handle, and a strict URL rule would reject "@name". */
          name: "portfolioLink", type: "text", required: true, maxlength: 500,
          label: "Portfolio — a link, a PDF, or just an Instagram handle",
          placeholder: "https://… or @yourhandle",
          help: "We look at the work, not the label on it."
        }
      ]
    },
    {
      id: "reel", title: "Something you edited",
      fields: [
        {
          name: "reelUrl", type: "url", required: true,
          label: "One reel or video you edited yourself",
          placeholder: "https://instagram.com/reel/…",
          help: "A public link. Instagram, YouTube, Drive — whatever's easiest."
        }
      ]
    },
    {
      id: "taste", title: "Your taste",
      fields: [
        {
          name: "bestAccount", type: "textarea", required: true, rows: 5, maxlength: 1500,
          label: "Which account is doing fashion content best in India right now — and why?",
          placeholder: "One line on who, one on why.",
          help: "There's no correct answer. We're reading for whether you actually watch the feed."
        }
      ]
    },
    {
      id: "tools", title: "Your toolkit",
      hint: "Pick everything you actually use, not everything you've opened.",
      fields: [
        {
          name: "tools", type: "tags", label: "What do you design and edit in?", required: true,
          options: ASSOCIATE_TOOLS,
          help: "CapCut is completely fine. Choose any that apply, and add anything we've missed under Other."
        }
      ]
    },
    {
      id: "compensation", title: "Notice and compensation",
      hint: "We ask up front so neither of us wastes the other's time.",
      fields: [
        {
          name: "noticePeriod", type: "select", required: true,
          label: "When could you start?",
          placeholder: "Select one…", options: NOTICE_OPTIONS
        },
        {
          name: "currentComp", type: "currency", required: true,
          label: "Current monthly compensation",
          help: "Monthly, not annual. Enter 0 if you're between roles or currently studying."
        },
        {
          name: "expectedComp", type: "currency", required: true,
          label: "Expected monthly compensation",
          help: "Monthly, not annual."
        }
      ]
    },
    {
      id: "wrapping-up", title: "Wrapping up",
      fields: resumeFields(false).concat([anythingElseField()])
    },
    reviewStep()
  ];

  /* ── ROLE 3 — Campus Marketing Ambassador ─────────────────────────
     Shortest form of the three, on purpose. The applicant is a student on
     a phone, often mid-scroll from an Instagram link, and every extra
     field costs exactly the candidate this role is trying to reach. No
     compensation step: the stipend is fixed and published in the JD, so
     asking what they expect would be theatre. No resume required either —
     who they know on campus matters more than a CV a fresher hasn't
     written yet. */

  var AMBASSADOR_COMMITMENT = [
    { value: "yes", label: "Yes — 12–15 hrs/week, the full 2 months" },
    { value: "most-weeks", label: "Most weeks, with a dip around exams" },
    { value: "less", label: "Less than that" }
  ];

  var AMBASSADOR_STEPS = [
    {
      id: "about", title: "About you",
      hint: "Two quick things to start.",
      fields: [nameField(), emailField()]
    },
    {
      id: "reaching-you", title: "Reaching you",
      hint: "So we can actually get hold of you.",
      fields: [phoneField(), locationField()]
    },
    {
      id: "campus", title: "Your campus",
      context: "The role is campus-specific, so we need to know which one you'd be running.",
      fields: [
        {
          name: "college", type: "text", required: true, maxlength: 200,
          label: "Which college are you at?",
          placeholder: "Hindu College, Delhi University"
        },
        {
          name: "courseYear", type: "text", required: true, maxlength: 120,
          label: "Course and year",
          placeholder: "BA Economics, 2nd year"
        }
      ]
    },
    {
      id: "campus-reach", title: "Who you know",
      context: "This is the part of the role that can't be taught, so it's the part we read hardest.",
      fields: [
        {
          name: "campusReach", type: "textarea", required: true, rows: 6, maxlength: 2000,
          label: "Which groups, societies, or circles are you plugged into on campus?",
          placeholder: "Fashion society, the fest organising committee, hostel floor group of 200, the meme page…",
          help: "Names and rough numbers beat adjectives. Tell us what you could actually reach next week."
        }
      ]
    },
    {
      id: "style", title: "Your style",
      fields: [
        {
          name: "whyStyle", type: "textarea", required: true, rows: 5, maxlength: 1500,
          label: "What's your relationship with clothes and personal style?",
          placeholder: "A few honest lines.",
          help: "There's no correct answer. We're reading for whether you'd use Attira yourself."
        }
      ]
    },
    {
      id: "content", title: "Your content",
      fields: [
        {
          /* `text`, not `url`, and matching the Associate's portfolio field:
             most applicants will answer with "@handle", which a strict URL
             rule would reject outright. */
          name: "contentLink", type: "text", required: true, maxlength: 500,
          label: "Your Instagram handle, or a link to something you've posted",
          placeholder: "@yourhandle or https://…",
          help: "A private account is fine — tell us the handle and we'll request. Polished isn't required."
        }
      ]
    },
    {
      id: "commitment", title: "Your availability",
      hint: "We ask up front so neither of us wastes the other's time.",
      fields: [
        {
          name: "commitment", type: "select", required: true,
          label: "Can you give this 12–15 hrs/week for 2 months?",
          placeholder: "Select one…", options: AMBASSADOR_COMMITMENT
        }
      ]
    },
    {
      id: "wrapping-up", title: "Wrapping up",
      fields: resumeFields(false).concat([anythingElseField()])
    },
    reviewStep()
  ];

  var ROLES = [
    { id: "content-design-lead", title: "Content & Design Lead", steps: LEAD_STEPS },
    { id: "design-social-associate", title: "Design & Social Media Associate", steps: ASSOCIATE_STEPS },
    { id: "campus-marketing-ambassador", title: "Campus Marketing Ambassadors", steps: AMBASSADOR_STEPS }
  ];

  function findRole(id) {
    for (var i = 0; i < ROLES.length; i++) {
      if (ROLES[i].id === id) return ROLES[i];
    }
    return null;
  }

  /* Every field a role declares, flattened — used by the server to build
     its insert key list and by the CSV export to build headers. */
  function fieldsFor(roleId) {
    var role = findRole(roleId);
    var out = [];
    if (!role) return out;
    for (var s = 0; s < role.steps.length; s++) {
      for (var f = 0; f < role.steps[s].fields.length; f++) out.push(role.steps[s].fields[f]);
    }
    return out;
  }

  /* ── the shared referee ───────────────────────────────────────────
     Returns an error string, or null when the value is acceptable.
     Both careers.js (per step, before Next) and server.js (on POST) call
     this, which is what keeps the two verdicts identical. */

  function isEmpty(field, value, answers) {
    if (field.type === "linklist") {
      if (!value || !value.length) return true;
      for (var i = 0; i < value.length; i++) if (trimStr(value[i])) return false;
      return true;
    }
    if (field.type === "tags") {
      var picked = value && value.length;
      var other = answers ? trimStr(answers[field.name + "Other"]) : "";
      return !picked && !other;
    }
    return !trimStr(value);
  }

  function optionValues(field) {
    var out = [];
    for (var i = 0; i < (field.options || []).length; i++) {
      var o = field.options[i];
      out.push(typeof o === "string" ? o : o.value);
    }
    return out;
  }

  function validateField(field, value, answers) {
    if (isEmpty(field, value, answers)) {
      if (!field.required) return null;
      /* "Required, unless its partner field was answered" — how the
         resume upload and the resume link satisfy each other. */
      if (field.requiredUnless && answers && trimStr(answers[field.requiredUnless])) return null;
      if (field.emptyMessage) return field.emptyMessage;
      if (field.type === "tags") return "Pick at least one, or add your own under Other.";
      if (field.type === "linklist") return "Add at least one link.";
      if (field.type === "select") return "Please choose an option.";
      return "This one's required.";
    }

    switch (field.type) {
      case "email":
        return EMAIL_RE.test(trimStr(value)) ? null : "That doesn't look like a valid email address.";

      case "tel":
        return PHONE_RE.test(normalizePhone(value))
          ? null
          : "Enter a phone number with 7–15 digits, optionally starting with +.";

      case "url":
        return URL_RE.test(trimStr(value)) ? null : "Enter a full link, starting with https://";

      case "select":
        return optionValues(field).indexOf(trimStr(value)) === -1 ? "Please choose an option." : null;

      /* The value is the opaque key /api/careers/upload returned, so
         there is nothing to check here beyond "something was uploaded".
         The server re-checks the key's shape before trusting it. */
      case "file":
        return null;

      case "currency":
        return digitsOnly(value).length ? null : "Enter an amount, or 0 if this doesn't apply.";

      case "linklist":
        var items = value || [];
        if (field.maxItems && items.length > field.maxItems) {
          return "Please add no more than " + field.maxItems + " links.";
        }
        for (var i = 0; i < items.length; i++) {
          var link = trimStr(items[i]);
          if (link && !URL_RE.test(link)) return "Each link must be a full URL starting with https://";
        }
        return null;

      case "tags":
        // Free text under "Other" is always allowed; the chip list itself is
        // an allowlist so a crafted request can't inject arbitrary values.
        var allowed = optionValues(field);
        var picked = value || [];
        for (var t = 0; t < picked.length; t++) {
          if (allowed.indexOf(picked[t]) === -1) return "That isn't one of the options.";
        }
        return null;

      default:
        if (field.maxwords && countWords(value) > field.maxwords) {
          return "Please keep this to " + field.maxwords + " words or fewer.";
        }
        if (field.maxlength && trimStr(value).length > field.maxlength) {
          return "That's longer than we can store — please trim it a little.";
        }
        return null;
    }
  }

  var RENDERABLE = {
    text: 1, email: 1, tel: 1, url: 1, textarea: 1,
    select: 1, tags: 1, currency: 1, linklist: 1, file: 1
  };

  /* ── boot-time spec check ─────────────────────────────────────────
     There is no build step and no type checker here, and server.js
     require()s this file — so a malformed spec would take down the API as
     well as the page. Fail loudly at startup instead of mysteriously at
     request time. Runs once, costs microseconds. */
  function validateSpec() {
    for (var r = 0; r < ROLES.length; r++) {
      var role = ROLES[r];
      var seen = {};
      if (!role.id || !role.title || !role.steps) throw new Error("careers-roles: role " + r + " is missing id/title/steps");
      for (var s = 0; s < role.steps.length; s++) {
        var step = role.steps[s];
        if (!step.id) throw new Error("careers-roles: " + role.id + " step " + s + " has no id");
        for (var f = 0; f < step.fields.length; f++) {
          var field = step.fields[f];
          if (!field.name) throw new Error("careers-roles: " + role.id + "/" + step.id + " has a field with no name");
          if (seen[field.name]) throw new Error("careers-roles: duplicate field '" + field.name + "' in " + role.id);
          seen[field.name] = true;
          if (!RENDERABLE[field.type]) {
            throw new Error("careers-roles: unknown type '" + field.type + "' on " + role.id + "." + field.name);
          }
          if ((field.type === "select" || field.type === "tags") && !(field.options || []).length) {
            throw new Error("careers-roles: " + role.id + "." + field.name + " is a " + field.type + " with no options");
          }
        }
      }
    }
  }

  validateSpec();

  return {
    ROLES: ROLES,
    findRole: findRole,
    fieldsFor: fieldsFor,
    validateField: validateField,
    isEmpty: isEmpty,
    optionValues: optionValues,
    countWords: countWords,
    trimStr: trimStr,
    normalizePhone: normalizePhone,
    digitsOnly: digitsOnly,
    CURRENCIES: CURRENCIES,
    MAX_LINKS: MAX_LINKS,
    EMAIL_RE: EMAIL_RE,
    URL_RE: URL_RE,
    PHONE_RE: PHONE_RE
  };
});
