/* ===================================================================
   Attira — one definition of "an application as a row"

   Two consumers need to flatten an applications row into columns: the
   admin CSV endpoint (/api/careers/export) and the Google Drive index
   sheet (careers-drive.js). They used to be the same code copy-pasted;
   this module is the single copy so a new question can't appear in one
   and not the other.

   Everything here derives from careers-roles.js — the SAME spec the form
   and the API validate against — so adding a role or a question needs no
   edit in this file.
   =================================================================== */

const roles = require("./careers-roles");

/* Columns the applications table holds directly, in the order a human
   wants to read them. Mirrors careers-db.js's real columns; `answers`
   is expanded per-role by headerFor()/rowFor() instead of dumped raw. */
const BASE = [
  "id", "ref", "role", "created_at", "full_name", "email", "phone",
  "location", "resume_url", "current_comp", "expected_comp", "comp_currency",
  "anything_else", "utm_source",
];

/* Field names already covered by a BASE column — skipped when expanding
   the role-specific answers so they aren't written twice. resumeFile is
   here too: the uploaded file lands in file_keys and is reported as a
   Drive link, not as an answer. */
const COMMON_FIELDS = new Set([
  "fullName", "email", "phone", "location", "resumeUrl", "resumeFile",
  "anythingElse", "currentComp", "expectedComp",
]);

/* ── CSV injection ───────────────────────────────────────────────────
   Applicant-controlled text lands in Excel and — via the Drive index —
   in Google Sheets, both of which execute a cell that opens with = + -
   or @. A name like `=IMPORTXML("evil","//x")` would run against your
   own account, so anything formula-shaped is prefixed with an apostrophe
   and displays as plain text. */
function neutralize(s) {
  return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
}

function csvEscape(v) {
  if (v === null || v === undefined) return "";
  const s = neutralize(String(v));
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/* Flatten one stored answer for a single cell. */
function cellFor(field, value) {
  if (value === null || value === undefined) return "";
  if (field.type === "linklist") return (value || []).join(" | ");
  if (field.type === "select") {
    for (const o of field.options || []) if (o.value === value) return o.label;
    return value;
  }
  if (Array.isArray(value)) return value.join(", ");
  return value;
}

/* The role-specific questions, in the order they were asked — so a
   role-filtered export reads as a transcript of the form. */
function roleFields(roleId) {
  return roles.fieldsFor(roleId).filter((f) => !COMMON_FIELDS.has(f.name) && f.type !== "file");
}

function parseAnswers(row) {
  try {
    return JSON.parse(row.answers || "{}");
  } catch (e) {
    return {};
  }
}

/* Header for a role-filtered export. Without a roleId the answers blob
   is passed through whole, so nothing is unreachable in an all-roles
   export where the questions differ per row. */
function headerFor(roleId) {
  if (!roleId) return BASE.concat(["answers_json"]);
  return BASE.concat(roleFields(roleId).map((f) => f.csvLabel || f.name));
}

/* Raw (unescaped) cell values for one row, aligned to headerFor(). */
function rowFor(roleId, row) {
  const base = BASE.map((c) => row[c]);
  if (!roleId) return base.concat([row.answers]);

  const parsed = parseAnswers(row);
  for (const f of roleFields(roleId)) {
    let v = cellFor(f, parsed[f.name]);
    // A tags field's free-text "Other" belongs in the same cell as the chips.
    if (f.type === "tags" && parsed[f.name + "Other"]) {
      v = v ? v + ", " + parsed[f.name + "Other"] : parsed[f.name + "Other"];
    }
    base.push(v);
  }
  return base;
}

function toCsv(header, rows) {
  const lines = [header.map(csvEscape).join(",")];
  for (const r of rows) lines.push(r.map(csvEscape).join(","));
  return lines.join("\n") + "\n";
}

/* ── The Drive index sheet ───────────────────────────────────────────
   Deliberately NOT the per-role export: one uniform table across every
   role is what you actually scan when shortlisting, and the full answer
   set already lives in each candidate's application doc. */
const INDEX_HEADER = [
  "Ref", "Applied", "Role", "Name", "Email", "Phone", "Location",
  "Current comp", "Expected comp", "Currency", "Resume", "Folder",
  "Application", "Sync",
];

/* `links` carries whatever the Drive worker managed to create for this
   row — absent for a row that hasn't synced yet, which is why every
   lookup below is defensive. */
function indexRow(row, links = {}) {
  const role = roles.findRole(row.role);
  const resume = links.resumeUrl || row.resume_url || "";
  return [
    row.ref,
    (row.created_at || "").replace("T", " ").replace("Z", ""),
    role ? role.title : row.role,
    row.full_name,
    row.email,
    row.phone || "",
    row.location || "",
    row.current_comp === null || row.current_comp === undefined ? "" : row.current_comp,
    row.expected_comp === null || row.expected_comp === undefined ? "" : row.expected_comp,
    row.comp_currency || "",
    resume,
    links.folderUrl || "",
    links.docUrl || "",
    row.drive_status || "pending",
  ];
}

function indexCsv(rows, linksByRef = {}) {
  return toCsv(INDEX_HEADER, rows.map((r) => indexRow(r, linksByRef[r.ref] || {})));
}

module.exports = {
  BASE,
  COMMON_FIELDS,
  INDEX_HEADER,
  csvEscape,
  neutralize,
  cellFor,
  roleFields,
  parseAnswers,
  headerFor,
  rowFor,
  toCsv,
  indexRow,
  indexCsv,
};
