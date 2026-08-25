import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { buildSeedSections } from "./seedFormData";

const dataDir = path.join(process.cwd(), "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const dbPath = process.env.AED_DB_PATH || path.join(dataDir, "aed.db");

// A true blocking sleep for use in this module's synchronous, top-level
// init path (better-sqlite3 is sync-only end to end, so there's no `await`
// available here to wait on) — Atomics.wait on a throwaway buffer, the
// standard Node idiom for this, rather than a CPU-spinning loop.
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function isSqliteBusy(err) {
  return err?.code === "SQLITE_BUSY" || /SQLITE_BUSY/i.test(String(err?.message || err || ""));
}

// The Railway build step imports this module too (to statically collect
// page data for every route, including dynamic ones like /report/[id]),
// which opens a second connection to this same file on the same mounted
// volume the *currently live* deployment already has open. WAL mode allows
// concurrent readers, but write-lock contention between the two (e.g. the
// build starting mid-way through a live submission, or both processes
// running this same schema-init block near-simultaneously) can throw
// SQLITE_BUSY — busy_timeout makes SQLite itself wait out brief contention
// per-statement, but that alone still wasn't enough to stop two builds
// from failing outright on this exact error (2026-08-19), so the whole
// open-and-init sequence below is retried from scratch a few times on
// SQLITE_BUSY specifically, as a second, coarser layer on top of it.
function openAndInitDb() {
  const conn = new Database(dbPath);
  conn.pragma("busy_timeout = 20000");
  conn.pragma("journal_mode = WAL");
  conn.pragma("foreign_keys = ON");

  conn.exec(`
    CREATE TABLE IF NOT EXISTS submissions (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      hotel TEXT,
      first_name TEXT,
      last_name TEXT,
      email TEXT,
      phone TEXT,
      has_aed TEXT,
      total_points INTEGER,
      total_max INTEGER,
      prepared_points INTEGER,
      prepared_max INTEGER,
      answers_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS form_sections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_index INTEGER NOT NULL,
      letter TEXT,
      title TEXT NOT NULL,
      note TEXT,
      is_supplementary INTEGER NOT NULL DEFAULT 0,
      unscored INTEGER NOT NULL DEFAULT 0,
      visible_if_question_id INTEGER,
      visible_if_value TEXT
    );

    CREATE TABLE IF NOT EXISTS form_questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      section_id INTEGER NOT NULL REFERENCES form_sections(id) ON DELETE CASCADE,
      order_index INTEGER NOT NULL,
      type TEXT NOT NULL,
      label TEXT NOT NULL,
      hint TEXT,
      required INTEGER NOT NULL DEFAULT 0,
      unscored INTEGER NOT NULL DEFAULT 0,
      max_selections INTEGER,
      max_selections_linked_question_id INTEGER,
      derived_from_date_question_id INTEGER,
      field_role TEXT,
      gate_role TEXT,
      gate_value TEXT,
      scale_min INTEGER,
      scale_max INTEGER,
      scale_min_label TEXT,
      scale_max_label TEXT
    );

    CREATE TABLE IF NOT EXISTS form_options (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      question_id INTEGER NOT NULL REFERENCES form_questions(id) ON DELETE CASCADE,
      order_index INTEGER NOT NULL,
      value TEXT NOT NULL,
      label TEXT NOT NULL,
      sub TEXT,
      points INTEGER NOT NULL DEFAULT 0,
      image_url TEXT,
      allow_free_text INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS admin_sessions (
      token_hash TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
  `);

  return conn;
}

let db = globalThis.__aedDb;
if (!db) {
  const MAX_ATTEMPTS = 4;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      db = openAndInitDb();
      break;
    } catch (err) {
      if (!isSqliteBusy(err) || attempt === MAX_ATTEMPTS) throw err;
      console.warn(`DB init hit SQLITE_BUSY (attempt ${attempt}/${MAX_ATTEMPTS}), retrying...`);
      sleepSync(500 * attempt);
    }
  }

  migrateSubmissionsTable();
  migrateOptionImages();
  migrateOptionLabels();
  migrateExpiryTierGranularity();
  migrateSerialNumberQuestionsEarly();
  migrateUnitScopedPhysicalAndReadiness();
  migrateOptionImagesRound2();
  migrateAutoInspectionUnitFieldRoles();
  migrateExpiryDateLabels();
  migrateConfidenceScaleLabels();
  globalThis.__aedDb = db;
  seedFormIfEmpty();
}

// `CREATE TABLE IF NOT EXISTS` above is a no-op once the table already
// exists from an earlier deploy — it does not retroactively add new
// columns, so a column added after the table was first created needs an
// explicit, idempotent ALTER TABLE guarded by a check for whether it's
// already there.
function migrateSubmissionsTable() {
  const columns = db.prepare(`PRAGMA table_info(submissions)`).all();
  if (!columns.some((c) => c.name === "prize")) {
    // The Railway build step and the live deployment both import this
    // module against the same mounted volume (see the busy_timeout comment
    // above) — if both happen to run this check at nearly the same moment,
    // both can see the column missing and both attempt to add it, and
    // whichever loses the race gets a genuine SQLITE_ERROR ("duplicate
    // column name: prize"), not a lock-contention error busy_timeout can
    // wait out. That's a builder crash from a race that isn't actually a
    // problem — the column ends up added either way — so it's swallowed
    // the same defensive way as the unique index below, not a bug fixed by
    // being stricter here.
    try {
      db.exec(`ALTER TABLE submissions ADD COLUMN prize TEXT`);
    } catch (err) {
      console.warn("Could not add prize column (likely already added by a concurrent process):", err.message);
    }
  }
  // One entry per email is enforced in application code (see
  // getSubmissionByEmail + app/api/submissions/route.js) regardless — this
  // index is defense-in-depth, not the primary mechanism, so a failure
  // here (e.g. an already-deployed DB that happens to have pre-existing
  // duplicate/blank emails from before this feature existed) must not take
  // the whole app down.
  try {
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_submissions_email ON submissions(email) WHERE email != ''`);
  } catch (err) {
    console.warn("Could not create unique email index (likely pre-existing duplicate emails):", err.message);
  }
}

// seedFormIfEmpty() below only ever runs once (the very first boot, when
// form_sections is empty) — changing an imageUrl in seedFormData.js has no
// effect on a database that was already seeded before that change existed,
// which is every environment past its first deploy. This swaps specific
// known icon paths for real photos, matched by the exact old path + the
// option's value + a snippet of its question's label, so it only touches
// rows that still hold the original generic icon and never overwrites
// anything an admin has since customized through the form builder.
function migrateOptionImages() {
  // Declared inside the function (not at module scope) so it's safely
  // hoisted-and-initialized before use regardless of where this function
  // declaration sits relative to its call site in the file.
  const replacements = [
    { questionLabelLike: "%battery installed correctly%", value: "yes", oldImage: "/icons/battery-ok.svg", newImage: "/reference/frx-battery-attached.jpg" },
    { questionLabelLike: "%pads connected and sealed%", value: "yes", oldImage: "/icons/pads-sealed.svg", newImage: "/reference/frx-pads-connected.jpg" },
    { questionLabelLike: "%cabinet intact and accessible%", value: "yes", oldImage: "/icons/cabinet-ok.svg", newImage: "/reference/aed-cabinet-example.jpg" },
    { questionLabelLike: "%AEDs installed in your hotel%", value: "yes", oldImage: "/icons/aed-present.svg", newImage: "/reference/aed-cabinet-ready.jpg" },
    { questionLabelLike: "%Paediatric Pad or Infant%", value: "pads", oldImage: "/icons/paed-pads.svg", newImage: "/reference/paed-pads-zoll-photo.jpg" },
    { questionLabelLike: "%Paediatric Pad or Infant%", value: "key", oldImage: "/icons/paed-key.svg", newImage: "/reference/paed-key-photo.jpg" },
    { questionLabelLike: "%emergency accessories%", value: "gloves", oldImage: "/icons/acc-gloves.svg", newImage: "/accessories/gloves.jpg" },
    { questionLabelLike: "%emergency accessories%", value: "razor", oldImage: "/icons/acc-razor.svg", newImage: "/accessories/razor.jpg" },
    { questionLabelLike: "%emergency accessories%", value: "scissors", oldImage: "/icons/acc-scissors.svg", newImage: "/accessories/scissors.jpg" },
    { questionLabelLike: "%emergency accessories%", value: "wipes", oldImage: "/icons/acc-wipes.svg", newImage: "/accessories/wipes.jpg" },
  ];
  const stmt = db.prepare(`
    UPDATE form_options SET image_url = ?
    WHERE image_url = ? AND value = ?
      AND question_id IN (SELECT id FROM form_questions WHERE label LIKE ?)
  `);
  for (const r of replacements) {
    stmt.run(r.newImage, r.oldImage, r.value, r.questionLabelLike);
  }
}

// The expiry-status "Within next 6 months" bucket was too coarse — a
// battery expiring in 5 days looked identical to one expiring in 5 months,
// both showing the exact same generic badge, which hid exactly the cases
// that need the most urgent follow-up. Splits it into three: within a
// week, within a month, within 6 months (see the new computeExpiryTierValue
// day boundaries in lib/genericScoring.js). Two idempotent steps:
//  1. Repoint every existing tier's points onto the new 7-point scale,
//     matched by value — an admin-renamed *label* is untouched, only the
//     points (which this feature owns end-to-end) get corrected.
//  2. Insert the two new tier options onto every question that already has
//     the old tier set, skipped per-question if it's already there.
function migrateExpiryTierGranularity() {
  const questions = db.prepare(`SELECT id FROM form_questions WHERE label LIKE '%expiry status%'`).all();
  const repoint = db.prepare(`UPDATE form_options SET points = ? WHERE question_id = ? AND value = ?`);
  const newPoints = { expired: 1, within1w: 2, within1m: 3, within6m: 4, gt6m: 5, "1to2y": 6, gt2y: 7 };
  for (const q of questions) {
    for (const [value, points] of Object.entries(newPoints)) {
      repoint.run(points, q.id, value);
    }
    const existingValues = new Set(
      db.prepare(`SELECT value FROM form_options WHERE question_id = ?`).all(q.id).map((r) => r.value)
    );
    if (existingValues.has("within6m") && !existingValues.has("within1w")) {
      createOption(q.id, { value: "within1w", label: "Within the next week", points: 2 });
    }
    if (existingValues.has("within6m") && !existingValues.has("within1m")) {
      createOption(q.id, { value: "within1m", label: "Within the next month", points: 3 });
    }
  }
}

// "No — sound condition" paired an unadorned "No" with a trailing dash
// clause that, once the button text wraps onto two lines on a narrow
// screen ("No" / "— sound condition"), reads as a non-sequitur rather than
// an answer to "is there any visible damage?" — "No, good condition" says
// the same thing without the ambiguity. Matched by exact old label text +
// value, so this is a no-op on re-run and a safe no-op if an admin already
// customized the label through the form builder.
function migrateOptionLabels() {
  const stmt = db.prepare(`
    UPDATE form_options SET label = ?
    WHERE label = ? AND value = ?
      AND question_id IN (SELECT id FROM form_questions WHERE label LIKE ?)
  `);
  for (const r of [
    { questionLabelLike: "%visible damage on AED%", value: "no", oldLabel: "No — sound condition", newLabel: "No, good condition" },
  ]) {
    stmt.run(r.newLabel, r.oldLabel, r.value, r.questionLabelLike);
  }
}

// "expiry date" -> "Shelf Life Expiry Date" per the client's own wording —
// question labels only, not the derived "expiry status" callout questions
// (those get their own instructional message per tier, see
// expiryStatusMessage in AuditWizard.jsx, not a label change). Run last,
// after migrateAutoInspectionUnitFieldRoles above (which still matches
// unit 2's date questions by their *old* label text) so this never renames
// a label out from under an older, label-text-keyed migration that hasn't
// run yet on a given database.
function migrateExpiryDateLabels() {
  const relabel = db.prepare(`UPDATE form_questions SET label = ? WHERE label = ?`);
  for (const [oldLabel, newLabel] of [
    ["Select Battery (1) expiry date", "Select Battery (1) Shelf Life Expiry Date"],
    ["Electrode pad (1) expiry date", "Electrode Pad (1) Shelf Life Expiry Date"],
    ["Select Battery (2) expiry date", "Select Battery (2) Shelf Life Expiry Date"],
    ["Expiry date of Electrode pads (2)", "Electrode Pad (2) Shelf Life Expiry Date"],
  ]) {
    relabel.run(newLabel, oldLabel);
  }
}

// "Min"/"Max"/"Max Confident" were terse, inconsistent between the two
// confidence-scale questions, and didn't actually say what's being rated.
// Matched by exact old label pair so an admin who's already customized
// either scale's end labels keeps their own text.
function migrateConfidenceScaleLabels() {
  const relabel = db.prepare(
    `UPDATE form_questions SET scale_min_label = ?, scale_max_label = ?
     WHERE label = ? AND scale_min_label = ? AND scale_max_label = ?`
  );
  for (const [label, oldMin, oldMax] of [
    ["How confident are you in performing Quality CPR?", "Min", "Max"],
    ["How confident are you in using an AED?", "Min", "Max Confident"],
  ]) {
    relabel.run("Not confident", "Very confident", label, oldMin, oldMax);
  }
}

// Physical Status and Readiness Alert used to ask one flat, generic
// question no matter how many AEDs a property reported — a second AED
// with a dead battery or a broken cabinet had no way to be reported at
// all, since there was only ever one "Is the battery installed correctly?"
// answer for the whole property. Retrofits the same per-unit "(2)"
// template-cloning pattern Expiry Status already used (see
// expandUnitQuestions in lib/genericScoring.js — this doesn't touch that
// function at all, it only adds more sections with a "(2)"-labeled
// question for it to find).
//
// Two idempotent, independent steps:
//  1. Relabel the existing unit-1 questions to name the unit explicitly
//     ("Is the battery installed correctly?" -> "...battery (1)...").
//     A plain UPDATE...WHERE label = <old text> is naturally a no-op on
//     re-run (the old label no longer exists to match) and a safe no-op if
//     an admin already renamed it through the form builder (their label
//     stands; the feature still works off the "(2)" template regardless of
//     what unit 1's own label says).
//  2. Add the "(2)" template question++options for each, skipped if a
//     question with that exact label already exists in the section.
function migrateUnitScopedPhysicalAndReadiness() {
  const relabel = db.prepare(`UPDATE form_questions SET label = ? WHERE label = ?`);
  for (const [oldLabel, newLabel] of [
    ["Is the battery installed correctly?", "Is the battery (1) installed correctly?"],
    ["Are the pads connected and sealed?", "Are the pads (1) connected and sealed?"],
    ["Is there any visible damage (cracks, swelling, or leakage)?", "Is there any visible damage on AED (1) (cracks, swelling, or leakage)?"],
    ["Is the AED cabinet intact and accessible?", "Is the AED (1) cabinet intact and accessible?"],
    ["Is your AED displaying a green (ready) indicator?", "Is AED (1) displaying a green (ready) indicator?"],
    ["Is there any warning beep or error message?", "Is there any warning beep or error message on AED (1)?"],
    ["Self-test passed (if display available)?", "Self-test (1) passed (if display available)?"],
  ]) {
    relabel.run(newLabel, oldLabel);
  }

  function ensureTemplateQuestion(sectionTitle, label, options) {
    const section = db.prepare(`SELECT id FROM form_sections WHERE title = ?`).get(sectionTitle);
    if (!section) return; // admin renamed/removed the section — don't guess where to put this
    const exists = db.prepare(`SELECT id FROM form_questions WHERE section_id = ? AND label = ?`).get(section.id, label);
    if (exists) return; // already migrated
    const questionId = createQuestion(section.id, { type: "radio", label, required: false, unscored: true });
    options.forEach((o) => createOption(questionId, o));
  }

  ensureTemplateQuestion("Physical Status", "Is the battery (2) installed correctly?", [
    { value: "yes", label: "Yes", points: 5, imageUrl: "/icons/battery-ok.svg" },
    { value: "no", label: "No", points: 0, imageUrl: "/icons/battery-bad.svg" },
  ]);
  ensureTemplateQuestion("Physical Status", "Are the pads (2) connected and sealed?", [
    { value: "yes", label: "Yes", points: 5, imageUrl: "/icons/pads-sealed.svg" },
    { value: "no", label: "No", points: 0, imageUrl: "/icons/pads-unsealed.svg" },
  ]);
  ensureTemplateQuestion("Physical Status", "Is there any visible damage on AED (2) (cracks, swelling, or leakage)?", [
    { value: "yes", label: "Yes", points: 0, imageUrl: "/icons/damage-yes.svg" },
    { value: "no", label: "No, good condition", points: 3, imageUrl: "/icons/damage-no.svg" },
  ]);
  ensureTemplateQuestion("Physical Status", "Is the AED (2) cabinet intact and accessible?", [
    { value: "yes", label: "Yes", points: 2, imageUrl: "/reference/aed-cabinet-installed.jpg" },
    { value: "no", label: "No", points: 0, imageUrl: "/reference/aed-cabinet-not-installed.jpg" },
  ]);
  ensureTemplateQuestion("Readiness Alert on AED", "Is AED (2) displaying a green (ready) indicator?", [
    { value: "green", label: "Green / Ready", sub: "Steady or slow-blinking", points: 3, imageUrl: "/reference/frx-status-ready.jpg" },
    { value: "red", label: "Red / Orange / Not ready", sub: "Fast-blinking or solid warning colour", points: 0, imageUrl: "/reference/frx-status-notready.jpg" },
  ]);
  ensureTemplateQuestion("Readiness Alert on AED", "Is there any warning beep or error message on AED (2)?", [
    { value: "no", label: "No — no warning beep or error", points: 3, imageUrl: "/icons/beep-no.svg" },
    { value: "yes", label: "Yes — warning beep or error present", points: 0, imageUrl: "/icons/beep-yes.svg" },
  ]);
  ensureTemplateQuestion("Readiness Alert on AED", "Self-test (2) passed (if display available)?", [
    { value: "passed", label: "Self-test passed", points: 4, imageUrl: "/icons/selftest-pass.svg" },
    { value: "nodisplay", label: "No digital display on this model", points: 2, imageUrl: "/icons/selftest-nodisplay.svg" },
    { value: "failed", label: "Self-test failed", points: 0, imageUrl: "/icons/selftest-fail.svg" },
  ]);

  db.prepare(`UPDATE form_sections SET note = ? WHERE title = 'Physical Status'`)
    .run("Scored on every reported AED unit — not just the first.");
  db.prepare(`UPDATE form_sections SET note = ? WHERE title = 'Readiness Alert on AED'`)
    .run("Status-light literacy, scored on every reported unit — look at the device, not just the manual.");
  db.prepare(`UPDATE form_sections SET note = ? WHERE title = 'Expiry Status'`)
    .run("Scored on every reported AED unit — not just the first.");
}

// Second round of real-photo replacements: the "cabinet not installed",
// readiness-indicator red/green, and CPR-mask options were still flat SVG
// icons (or, for unit 2's cabinet "Yes", reusing unit 1's stand-in photo)
// until now. Matched by question label + option value only, not by the
// option's *current* image — unlike migrateOptionImages above, some of
// these rows may already have been moved through an earlier stand-in image
// on a prior boot, so matching on old image could miss them. This always
// converges on the intended final image regardless of current state, and
// is a safe no-op to re-run.
function migrateOptionImagesRound2() {
  const stmt = db.prepare(`
    UPDATE form_options SET image_url = ?
    WHERE value = ?
      AND question_id IN (SELECT id FROM form_questions WHERE label LIKE ?)
  `);
  const replacements = [
    { questionLabelLike: "%AEDs installed in your hotel%", value: "no", newImage: "/reference/aed-cabinet-not-installed.jpg" },
    { questionLabelLike: "%cabinet intact and accessible%", value: "no", newImage: "/reference/aed-cabinet-not-installed.jpg" },
    { questionLabelLike: "%AED (2) cabinet intact and accessible%", value: "yes", newImage: "/reference/aed-cabinet-installed.jpg" },
    { questionLabelLike: "%displaying a green (ready) indicator%", value: "green", newImage: "/reference/frx-status-ready.jpg" },
    { questionLabelLike: "%displaying a green (ready) indicator%", value: "red", newImage: "/reference/frx-status-notready.jpg" },
    { questionLabelLike: "%emergency accessories%", value: "mask", newImage: "/accessories/mask.jpg" },
  ];
  for (const r of replacements) {
    stmt.run(r.newImage, r.value, r.questionLabelLike);
  }
}

// The unit (2) template questions above (created by ensureTemplateQuestion,
// or seeded directly for Expiry Status) never got a field_role — auto
// inspection (components/AutoInspection.jsx, lib/inspectionChecklist.js)
// could therefore only ever write its results onto unit 1's fields,
// regardless of how many AEDs a property actually reported. Also includes
// unit 1's own serial-number question: "serial_number_1" was only added to
// seedFormData.js after this database was first seeded, so on a live DB
// that predates that change the row exists but field_role is still NULL —
// same reason the unit-banner serial ("SN ...") failed to show for AED (1)
// specifically while AED (2) worked. Matched by exact label + field_role
// currently NULL, so this only ever fills in the gap and never clobbers a
// role an admin might have set through the form builder since.
function migrateAutoInspectionUnitFieldRoles() {
  const setRole = db.prepare(`UPDATE form_questions SET field_role = ? WHERE label = ? AND field_role IS NULL`);
  for (const [label, role] of [
    ["Enter the serial number of AED (1)", "serial_number_1"],
    ["Is the battery (2) installed correctly?", "battery_attached_2"],
    ["Are the pads (2) connected and sealed?", "pads_connected_2"],
    ["Is the AED (2) cabinet intact and accessible?", "aed_cabinet_ok_2"],
    ["Is AED (2) displaying a green (ready) indicator?", "readiness_indicator_2"],
    ["Select Battery (2) expiry date", "battery_expiry_date_2"],
    ["Expiry date of Electrode pads (2)", "pads_expiry_date_2"],
    ["Enter the serial number of AED (2)", "serial_number_2"],
  ]) {
    setRole.run(role, label);
  }
}

// Same seedFormIfEmpty()-only-runs-once problem as the two migrations
// above: moving the serial-number questions earlier in seedFormData.js
// only affects a brand-new database. This re-parents the existing
// question rows on an already-seeded one (client's live request: register
// serial numbers alongside AED count/model, not deep in Expiry Status).
// No scoring logic touched — text questions carry 0 points regardless of
// which section they live in (see questionMax), and the per-unit "(2)"
// template cloning in expandUnitQuestions already operates independently
// per-section, so moving these two rows is enough for it to clone
// "AED (3)", "(4)"... serial fields in their new home automatically.
function migrateSerialNumberQuestionsEarly() {
  const aedStatusSection = db.prepare(`SELECT id FROM form_sections WHERE title = 'AED Status'`).get();
  if (!aedStatusSection) return; // admin renamed/removed it — don't guess where to put these

  const serialQuestions = db
    .prepare(`SELECT id, section_id, label FROM form_questions WHERE label LIKE 'Enter the serial number of AED (%'`)
    .all();
  if (serialQuestions.length === 0) return; // admin removed them, or already migrated+renamed
  if (serialQuestions.every((q) => q.section_id === aedStatusSection.id)) return; // already migrated

  const { m: maxOrder } = db
    .prepare(`SELECT COALESCE(MAX(order_index), -1) AS m FROM form_questions WHERE section_id = ?`)
    .get(aedStatusSection.id);
  const move = db.prepare(`UPDATE form_questions SET section_id = ?, order_index = ? WHERE id = ?`);
  // Sorted so "(1)" always lands before "(2)" regardless of their original
  // row order — cosmetic, but matches every other unit-numbered question.
  [...serialQuestions]
    .sort((a, b) => a.label.localeCompare(b.label))
    .forEach((q, i) => move.run(aedStatusSection.id, maxOrder + 1 + i, q.id));
}

function seedFormIfEmpty() {
  const { count } = db.prepare(`SELECT COUNT(*) AS count FROM form_sections`).get();
  if (count > 0) return;

  const sections = buildSeedSections();
  let hasAedGateQuestionId = null;
  let pendingCountLinkQuestionId = null; // the "number of AEDs" question in the current section
  const insertSection = db.prepare(
    `INSERT INTO form_sections (order_index, letter, title, note, is_supplementary, unscored, visible_if_question_id, visible_if_value)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertQuestion = db.prepare(
    `INSERT INTO form_questions (section_id, order_index, type, label, hint, required, unscored, max_selections, max_selections_linked_question_id, derived_from_date_question_id, field_role, gate_role, gate_value, scale_min, scale_max, scale_min_label, scale_max_label)
     VALUES (@sectionId, @orderIndex, @type, @label, @hint, @required, @unscored, @maxSelections, @maxSelectionsLinkedQuestionId, @derivedFromDateQuestionId, @fieldRole, @gateRole, @gateValue, @scaleMin, @scaleMax, @scaleMinLabel, @scaleMaxLabel)`
  );
  const insertOption = db.prepare(
    `INSERT INTO form_options (question_id, order_index, value, label, sub, points, image_url, allow_free_text)
     VALUES (@questionId, @orderIndex, @value, @label, @sub, @points, @imageUrl, @allowFreeText)`
  );
  const updateQuestionLink = db.prepare(`UPDATE form_questions SET max_selections_linked_question_id = ? WHERE id = ?`);
  const updateQuestionDateLink = db.prepare(`UPDATE form_questions SET derived_from_date_question_id = ? WHERE id = ?`);
  const updateSectionVisibility = db.prepare(`UPDATE form_sections SET visible_if_question_id = ? WHERE id = ?`);

  const tx = db.transaction(() => {
    sections.forEach((section, sIdx) => {
      const sectionResult = insertSection.run(
        sIdx,
        section.letter || null,
        section.title,
        section.note || null,
        section.isSupplementary ? 1 : 0,
        section.unscored ? 1 : 0,
        null,
        section.visibleIfValue || null
      );
      const sectionId = sectionResult.lastInsertRowid;
      if (section.visibleIfValue) {
        // will be resolved once hasAedGateQuestionId is known (gate lives in section index 1, before this one for index >= 2)
      }
      pendingCountLinkQuestionId = null;
      let pendingDateQuestionId = null;

      (section.questions || []).forEach((question, qIdx) => {
        const qResult = insertQuestion.run({
          sectionId,
          orderIndex: qIdx,
          type: question.type,
          label: question.label,
          hint: question.hint || null,
          required: question.required ? 1 : 0,
          unscored: question.unscored ? 1 : 0,
          maxSelections: question.maxSelections ?? null,
          maxSelectionsLinkedQuestionId: null,
          derivedFromDateQuestionId: null,
          fieldRole: question.fieldRole || null,
          gateRole: question.gateRole || null,
          gateValue: question.gateValue || null,
          scaleMin: question.scaleMin ?? null,
          scaleMax: question.scaleMax ?? null,
          scaleMinLabel: question.scaleMinLabel || null,
          scaleMaxLabel: question.scaleMaxLabel || null,
        });
        const questionId = qResult.lastInsertRowid;

        if (question.fieldRole === "has_aed_gate") hasAedGateQuestionId = questionId;
        if (question.isCountLink) pendingCountLinkQuestionId = questionId;
        if (question.maxSelectionsLinkedToPrevious && pendingCountLinkQuestionId) {
          updateQuestionLink.run(pendingCountLinkQuestionId, questionId);
        }
        if (question.type === "date") pendingDateQuestionId = questionId;
        if (question.derivedFromPreviousDate && pendingDateQuestionId) {
          updateQuestionDateLink.run(pendingDateQuestionId, questionId);
        }

        (question.options || []).forEach((option, oIdx) => {
          insertOption.run({
            questionId,
            orderIndex: oIdx,
            value: option.value,
            label: option.label,
            sub: option.sub || null,
            points: option.points || 0,
            imageUrl: option.imageUrl || null,
            allowFreeText: option.allowFreeText ? 1 : 0,
          });
        });
      });

      if (section.visibleIfValue && hasAedGateQuestionId) {
        updateSectionVisibility.run(hasAedGateQuestionId, sectionId);
      }
    });
  });
  tx();
}

// ---------------- Form schema (sections/questions/options) ----------------

export function getFormSchema() {
  const sections = db.prepare(`SELECT * FROM form_sections ORDER BY order_index`).all();
  const questions = db.prepare(`SELECT * FROM form_questions ORDER BY order_index`).all();
  const options = db.prepare(`SELECT * FROM form_options ORDER BY order_index`).all();

  const optionsByQuestion = new Map();
  for (const o of options) {
    const list = optionsByQuestion.get(o.question_id) || [];
    list.push({
      id: o.id,
      value: o.value,
      label: o.label,
      sub: o.sub,
      points: o.points,
      imageUrl: o.image_url,
      allowFreeText: !!o.allow_free_text,
    });
    optionsByQuestion.set(o.question_id, list);
  }

  const questionsBySection = new Map();
  for (const q of questions) {
    const list = questionsBySection.get(q.section_id) || [];
    list.push({
      id: q.id,
      type: q.type,
      label: q.label,
      hint: q.hint,
      required: !!q.required,
      unscored: !!q.unscored,
      maxSelections: q.max_selections,
      maxSelectionsLinkedQuestionId: q.max_selections_linked_question_id,
      derivedFromDateQuestionId: q.derived_from_date_question_id,
      fieldRole: q.field_role,
      gateRole: q.gate_role,
      gateValue: q.gate_value,
      scaleMin: q.scale_min,
      scaleMax: q.scale_max,
      scaleMinLabel: q.scale_min_label,
      scaleMaxLabel: q.scale_max_label,
      options: optionsByQuestion.get(q.id) || [],
    });
    questionsBySection.set(q.section_id, list);
  }

  return {
    sections: sections.map((s) => ({
      id: s.id,
      letter: s.letter,
      title: s.title,
      note: s.note,
      isSupplementary: !!s.is_supplementary,
      unscored: !!s.unscored,
      visibleIfQuestionId: s.visible_if_question_id,
      visibleIfValue: s.visible_if_value,
      questions: questionsBySection.get(s.id) || [],
    })),
  };
}

function nextOrderIndex(table, whereSql, whereArgs) {
  const row = db.prepare(`SELECT COALESCE(MAX(order_index), -1) AS m FROM ${table} ${whereSql}`).get(...whereArgs);
  return row.m + 1;
}

export function createSection(fields) {
  const orderIndex = nextOrderIndex("form_sections", "", []);
  const result = db
    .prepare(
      `INSERT INTO form_sections (order_index, letter, title, note, is_supplementary, unscored, visible_if_question_id, visible_if_value)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      orderIndex,
      fields.letter || null,
      fields.title || "Untitled section",
      fields.note || null,
      fields.isSupplementary ? 1 : 0,
      fields.unscored ? 1 : 0,
      fields.visibleIfQuestionId || null,
      fields.visibleIfValue || null
    );
  return result.lastInsertRowid;
}

export function updateSection(id, fields) {
  const cur = db.prepare(`SELECT * FROM form_sections WHERE id = ?`).get(id);
  if (!cur) return;
  db.prepare(
    `UPDATE form_sections SET letter=@letter, title=@title, note=@note, is_supplementary=@is_supplementary,
     unscored=@unscored, visible_if_question_id=@visible_if_question_id, visible_if_value=@visible_if_value WHERE id=@id`
  ).run({
    id,
    letter: fields.letter ?? cur.letter,
    title: fields.title ?? cur.title,
    note: fields.note ?? cur.note,
    is_supplementary: fields.isSupplementary != null ? (fields.isSupplementary ? 1 : 0) : cur.is_supplementary,
    unscored: fields.unscored != null ? (fields.unscored ? 1 : 0) : cur.unscored,
    visible_if_question_id: fields.visibleIfQuestionId !== undefined ? fields.visibleIfQuestionId : cur.visible_if_question_id,
    visible_if_value: fields.visibleIfValue !== undefined ? fields.visibleIfValue : cur.visible_if_value,
  });
}

export function deleteSection(id) {
  db.prepare(`DELETE FROM form_sections WHERE id = ?`).run(id);
}

export function moveSection(id, direction) {
  moveEntity("form_sections", "", [], id, direction);
}

function moveEntity(table, whereSql, whereArgs, id, direction) {
  const siblings = db.prepare(`SELECT id, order_index FROM ${table} ${whereSql} ORDER BY order_index`).all(...whereArgs);
  const idx = siblings.findIndex((s) => s.id === id);
  if (idx === -1) return;
  const swapIdx = direction === "up" ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= siblings.length) return;
  const a = siblings[idx];
  const b = siblings[swapIdx];
  const tx = db.transaction(() => {
    db.prepare(`UPDATE ${table} SET order_index = ? WHERE id = ?`).run(b.order_index, a.id);
    db.prepare(`UPDATE ${table} SET order_index = ? WHERE id = ?`).run(a.order_index, b.id);
  });
  tx();
}

export function createQuestion(sectionId, fields) {
  const orderIndex = nextOrderIndex("form_questions", "WHERE section_id = ?", [sectionId]);
  const result = db
    .prepare(
      `INSERT INTO form_questions (section_id, order_index, type, label, hint, required, unscored, max_selections, max_selections_linked_question_id, derived_from_date_question_id, field_role, gate_role, gate_value, scale_min, scale_max, scale_min_label, scale_max_label)
       VALUES (@sectionId, @orderIndex, @type, @label, @hint, @required, @unscored, @maxSelections, @maxSelectionsLinkedQuestionId, @derivedFromDateQuestionId, @fieldRole, @gateRole, @gateValue, @scaleMin, @scaleMax, @scaleMinLabel, @scaleMaxLabel)`
    )
    .run({
      sectionId,
      orderIndex,
      type: fields.type || "radio",
      label: fields.label || "Untitled question",
      hint: fields.hint || null,
      required: fields.required ? 1 : 0,
      unscored: fields.unscored ? 1 : 0,
      maxSelections: fields.maxSelections ?? null,
      maxSelectionsLinkedQuestionId: fields.maxSelectionsLinkedQuestionId ?? null,
      derivedFromDateQuestionId: fields.derivedFromDateQuestionId ?? null,
      fieldRole: fields.fieldRole || null,
      gateRole: fields.gateRole || null,
      gateValue: fields.gateValue || null,
      scaleMin: fields.scaleMin ?? null,
      scaleMax: fields.scaleMax ?? null,
      scaleMinLabel: fields.scaleMinLabel || null,
      scaleMaxLabel: fields.scaleMaxLabel || null,
    });
  return result.lastInsertRowid;
}

export function updateQuestion(id, fields) {
  const cur = db.prepare(`SELECT * FROM form_questions WHERE id = ?`).get(id);
  if (!cur) return;
  db.prepare(
    `UPDATE form_questions SET type=@type, label=@label, hint=@hint, required=@required, unscored=@unscored, max_selections=@max_selections,
     max_selections_linked_question_id=@max_selections_linked_question_id, derived_from_date_question_id=@derived_from_date_question_id,
     field_role=@field_role, gate_role=@gate_role,
     gate_value=@gate_value, scale_min=@scale_min, scale_max=@scale_max, scale_min_label=@scale_min_label, scale_max_label=@scale_max_label
     WHERE id=@id`
  ).run({
    id,
    type: fields.type ?? cur.type,
    label: fields.label ?? cur.label,
    hint: fields.hint !== undefined ? fields.hint : cur.hint,
    required: fields.required != null ? (fields.required ? 1 : 0) : cur.required,
    unscored: fields.unscored != null ? (fields.unscored ? 1 : 0) : cur.unscored,
    max_selections: fields.maxSelections !== undefined ? fields.maxSelections : cur.max_selections,
    max_selections_linked_question_id:
      fields.maxSelectionsLinkedQuestionId !== undefined ? fields.maxSelectionsLinkedQuestionId : cur.max_selections_linked_question_id,
    derived_from_date_question_id:
      fields.derivedFromDateQuestionId !== undefined ? fields.derivedFromDateQuestionId : cur.derived_from_date_question_id,
    field_role: fields.fieldRole !== undefined ? fields.fieldRole : cur.field_role,
    gate_role: fields.gateRole !== undefined ? fields.gateRole : cur.gate_role,
    gate_value: fields.gateValue !== undefined ? fields.gateValue : cur.gate_value,
    scale_min: fields.scaleMin !== undefined ? fields.scaleMin : cur.scale_min,
    scale_max: fields.scaleMax !== undefined ? fields.scaleMax : cur.scale_max,
    scale_min_label: fields.scaleMinLabel !== undefined ? fields.scaleMinLabel : cur.scale_min_label,
    scale_max_label: fields.scaleMaxLabel !== undefined ? fields.scaleMaxLabel : cur.scale_max_label,
  });
}

export function deleteQuestion(id) {
  db.prepare(`DELETE FROM form_questions WHERE id = ?`).run(id);
}

export function moveQuestion(id, direction) {
  const q = db.prepare(`SELECT section_id FROM form_questions WHERE id = ?`).get(id);
  if (!q) return;
  moveEntity("form_questions", "WHERE section_id = ?", [q.section_id], id, direction);
}

export function createOption(questionId, fields) {
  const orderIndex = nextOrderIndex("form_options", "WHERE question_id = ?", [questionId]);
  const result = db
    .prepare(
      `INSERT INTO form_options (question_id, order_index, value, label, sub, points, image_url, allow_free_text)
       VALUES (@questionId, @orderIndex, @value, @label, @sub, @points, @imageUrl, @allowFreeText)`
    )
    .run({
      questionId,
      orderIndex,
      value: fields.value || `option-${Date.now()}`,
      label: fields.label || "Untitled option",
      sub: fields.sub || null,
      points: fields.points || 0,
      imageUrl: fields.imageUrl || null,
      allowFreeText: fields.allowFreeText ? 1 : 0,
    });
  return result.lastInsertRowid;
}

export function updateOption(id, fields) {
  const cur = db.prepare(`SELECT * FROM form_options WHERE id = ?`).get(id);
  if (!cur) return;
  db.prepare(
    `UPDATE form_options SET value=@value, label=@label, sub=@sub, points=@points, image_url=@image_url, allow_free_text=@allow_free_text WHERE id=@id`
  ).run({
    id,
    value: fields.value ?? cur.value,
    label: fields.label ?? cur.label,
    sub: fields.sub !== undefined ? fields.sub : cur.sub,
    points: fields.points !== undefined ? fields.points : cur.points,
    image_url: fields.imageUrl !== undefined ? fields.imageUrl : cur.image_url,
    allow_free_text: fields.allowFreeText != null ? (fields.allowFreeText ? 1 : 0) : cur.allow_free_text,
  });
}

export function deleteOption(id) {
  db.prepare(`DELETE FROM form_options WHERE id = ?`).run(id);
}

export function moveOption(id, direction) {
  const o = db.prepare(`SELECT question_id FROM form_options WHERE id = ?`).get(id);
  if (!o) return;
  moveEntity("form_options", "WHERE question_id = ?", [o.question_id], id, direction);
}

export function getAllQuestionsFlat() {
  return db.prepare(`SELECT id, label, type, field_role FROM form_questions ORDER BY id`).all();
}

// ---------------- Submissions ----------------

export function insertSubmission({ answers, scored, identity, prize }) {
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO submissions
      (id, created_at, hotel, first_name, last_name, email, phone, has_aed,
       total_points, total_max, prepared_points, prepared_max, answers_json, prize)
     VALUES (@id, @createdAt, @hotel, @firstName, @lastName, @email, @phone, @hasAED,
       @totalPoints, @totalMax, @preparedPoints, @preparedMax, @answersJson, @prize)`
  ).run({
    id,
    createdAt,
    hotel: identity.hotel || "",
    firstName: identity.firstName || "",
    lastName: identity.lastName || "",
    email: normalizeEmail(identity.email),
    phone: identity.phone || "",
    hasAED: identity.hasAED || "",
    totalPoints: scored.total.points,
    totalMax: scored.total.max,
    preparedPoints: scored.prepared.points,
    preparedMax: scored.prepared.max,
    answersJson: JSON.stringify(answers),
    prize: prize || null,
  });
  return id;
}

export function getSubmission(id) {
  const row = db.prepare(`SELECT * FROM submissions WHERE id = ?`).get(id);
  if (!row) return null;
  return { ...row, answers: JSON.parse(row.answers_json) };
}

// Case/whitespace-insensitive so "Jane@Gmail.com" and "jane@gmail.com"
// count as the same entrant for the one-entry-per-email rule.
export function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

export function getSubmissionByEmail(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  return db.prepare(`SELECT id FROM submissions WHERE email = ?`).get(normalized) || null;
}

// Returns true if a row was actually deleted, so the API route can
// distinguish "already gone" (404) from a real deletion (200) — the id
// comes straight from an admin-typed URL param, not a trusted reference.
export function deleteSubmission(id) {
  const result = db.prepare(`DELETE FROM submissions WHERE id = ?`).run(id);
  return result.changes > 0;
}

export function listSubmissions() {
  return db
    .prepare(
      `SELECT id, created_at, hotel, first_name, last_name, email, phone, has_aed,
              total_points, total_max, prepared_points, prepared_max
       FROM submissions ORDER BY created_at DESC`
    )
    .all();
}

// Like listSubmissions, but with the full parsed answers — needed to
// re-score every submission against the *current* schema for the analytics
// dashboard (a form edited after old submissions came in should still
// aggregate consistently, same principle as an individual report).
export function listSubmissionsFull() {
  return db
    .prepare(`SELECT * FROM submissions ORDER BY created_at DESC`)
    .all()
    .map((r) => ({ ...r, answers: JSON.parse(r.answers_json) }));
}

// ---------- Admin sessions ----------
// A logged-in admin gets a random per-login token (not a value derived from
// the shared password), stored here only as its hash — so a DB read alone
// can't hand out a working cookie, and logout can actually revoke a session
// (deleting the row) instead of just clearing a cookie whose value would
// otherwise still be valid forever. See lib/adminAuth.js.
function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function createAdminSession(token, ttlMs) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlMs);
  db.prepare(`DELETE FROM admin_sessions WHERE expires_at < ?`).run(now.toISOString());
  db.prepare(`INSERT INTO admin_sessions (token_hash, created_at, expires_at) VALUES (?, ?, ?)`).run(
    hashToken(token),
    now.toISOString(),
    expiresAt.toISOString()
  );
}

export function isValidAdminSession(token) {
  if (!token) return false;
  const row = db.prepare(`SELECT expires_at FROM admin_sessions WHERE token_hash = ?`).get(hashToken(token));
  if (!row) return false;
  return new Date(row.expires_at).getTime() > Date.now();
}

export function deleteAdminSession(token) {
  db.prepare(`DELETE FROM admin_sessions WHERE token_hash = ?`).run(hashToken(token));
}

export default db;
