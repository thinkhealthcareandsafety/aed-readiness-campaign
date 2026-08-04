import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { buildSeedSections } from "./seedFormData";

const dataDir = path.join(process.cwd(), "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const dbPath = process.env.AED_DB_PATH || path.join(dataDir, "aed.db");

let db = globalThis.__aedDb;
if (!db) {
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
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
  `);

  globalThis.__aedDb = db;
  seedFormIfEmpty();
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

export function insertSubmission({ answers, scored, identity }) {
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO submissions
      (id, created_at, hotel, first_name, last_name, email, phone, has_aed,
       total_points, total_max, prepared_points, prepared_max, answers_json)
     VALUES (@id, @createdAt, @hotel, @firstName, @lastName, @email, @phone, @hasAED,
       @totalPoints, @totalMax, @preparedPoints, @preparedMax, @answersJson)`
  ).run({
    id,
    createdAt,
    hotel: identity.hotel || "",
    firstName: identity.firstName || "",
    lastName: identity.lastName || "",
    email: identity.email || "",
    phone: identity.phone || "",
    hasAED: identity.hasAED || "",
    totalPoints: scored.total.points,
    totalMax: scored.total.max,
    preparedPoints: scored.prepared.points,
    preparedMax: scored.prepared.max,
    answersJson: JSON.stringify(answers),
  });
  return id;
}

export function getSubmission(id) {
  const row = db.prepare(`SELECT * FROM submissions WHERE id = ?`).get(id);
  if (!row) return null;
  return { ...row, answers: JSON.parse(row.answers_json) };
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

export default db;
