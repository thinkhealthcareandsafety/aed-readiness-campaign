import { MongoClient } from "mongodb";
import crypto from "crypto";
import { buildSeedSections } from "./seedFormData";
import { scoreSubmission, expandUnitQuestions } from "./genericScoring";

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/aed-readiness";
const DB_NAME = "aed-readiness";

let client;
let db;

async function connectDB() {
  if (db) return db;
  try {
    client = new MongoClient(MONGODB_URI);
    await client.connect();
    db = client.db(DB_NAME);

    // Create indexes. The email one is the real one-entry-per-user
    // boundary — app/api/submissions/route.js's getSubmissionByEmail check
    // is only a courtesy read before the insert, not a guarantee, so two
    // near-simultaneous submissions with the same email could otherwise
    // both pass it and both insert (two prizes for one person). Partial +
    // unique so it only constrains real emails, matching the old SQLite
    // schema's `WHERE email != ''` partial unique index. Wrapped in
    // try/catch the same defensive way the SQLite version was: if a
    // pre-existing duplicate somehow already exists, failing index
    // creation must never take the whole app down over it.
    try {
      await db.collection("submissions").createIndex(
        { email: 1 },
        { unique: true, partialFilterExpression: { email: { $gt: "" } } }
      );
    } catch (err) {
      console.warn("Could not create unique email index (likely pre-existing duplicate emails):", err.message);
    }
    await db.collection("admin_sessions").createIndex({ expires_at: 1 });

    // Initialize schema if empty
    const sectionCount = await db.collection("form_sections").countDocuments();
    if (sectionCount === 0) {
      await seedFormIfEmpty();
    } else {
      await migrateDerivedDateLinks();
      await migrateOptionLabelTrims();
    }
    await migrateCertificateCounter();

    return db;
  } catch (err) {
    console.error("MongoDB connection failed:", err);
    throw err;
  }
}

// Backfills derived_from_date_question_id for a database that was already
// seeded before this link was wired up in seedFormIfEmpty — without it, an
// expiry-status radio renders as a normal manually-pickable option list
// instead of the intended read-only auto-computed-from-date callout (see
// the derivedFromDateQuestionId branch in AuditWizard.jsx). Matched by the
// exact date-question -> expiry-status-question label pairs seedFormData.js
// defines, so this is a no-op once already linked and never overwrites an
// admin's own edit made through the form builder since.
const DATE_TO_EXPIRY_LABEL_PAIRS = [
  ["Select Battery (1) Shelf Life Expiry Date", "Battery (1) expiry status"],
  ["Electrode Pad (1) Shelf Life Expiry Date", "Electrode Pads (1) expiry status"],
  ["Select Battery (2) Shelf Life Expiry Date", "Battery (2) expiry status"],
  ["Electrode Pad (2) Shelf Life Expiry Date", "Electrode Pads (2) expiry status"],
];

// certificate_number used to be assigned by reading the current max and
// adding 1 in the same call as the insert — a read-then-write with no
// atomicity, so two qualifying submissions arriving close together could
// both read the same max and both get issued the same "unique" number.
// This seeds a dedicated counter document (once, from whatever the
// highest already-assigned number is) that nextCertificateNumber() below
// increments atomically via $inc, so every subsequent assignment is race-
// free regardless of concurrent requests. A no-op once the counter
// exists — never resets it backward on a later boot.
async function migrateCertificateCounter() {
  const existing = await db.collection("counters").findOne({ _id: "certificate_number" });
  if (existing) return;
  const lastCert = await db
    .collection("submissions")
    .findOne({ certificate_number: { $ne: null } }, { sort: { certificate_number: -1 } });
  await db.collection("counters").insertOne({ _id: "certificate_number", seq: lastCert?.certificate_number || 0 });
}

async function nextCertificateNumber(d) {
  const result = await d
    .collection("counters")
    .findOneAndUpdate({ _id: "certificate_number" }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: "after" });
  // Driver-version defensive: some versions return the document directly,
  // others wrap it as { value: doc } — handle either shape rather than
  // assuming one.
  return result?.value?.seq ?? result?.seq;
}

async function migrateDerivedDateLinks() {
  for (const [dateLabel, expiryLabel] of DATE_TO_EXPIRY_LABEL_PAIRS) {
    const dateQuestion = await db.collection("form_questions").findOne({ label: dateLabel });
    if (!dateQuestion) continue;
    await db.collection("form_questions").updateMany(
      { label: expiryLabel, derived_from_date_question_id: null },
      { $set: { derived_from_date_question_id: dateQuestion._id } }
    );
  }
}

// Trims two option labels down per client feedback — "CPR mask / soft
// stretcher" to just "CPR mask" (a stretcher was never actually part of
// this kit item, the slash-suffix was left over from an earlier draft of
// the option), and drops the "Local emergency line" sub-caption under
// "Ambulance (108)" as redundant restating of what the label already
// says. seedFormData.js only affects a fresh seed, so a database seeded
// before this runs needs this backfill to see the same fix. Matched by
// exact old value, so a re-run is a no-op and an admin who's since
// customized either label through the form builder is left alone.
async function migrateOptionLabelTrims() {
  await db.collection("form_options").updateMany(
    { value: "mask", label: "CPR mask / soft stretcher" },
    { $set: { label: "CPR mask" } }
  );
  await db.collection("form_options").updateMany(
    { value: "ambulance", label: "Ambulance (108)", sub: "Local emergency line" },
    { $set: { sub: null } }
  );
}

async function seedFormIfEmpty() {
  const sections = buildSeedSections();
  let hasAedGateQuestionId = null;
  let pendingCountLinkQuestionId = null;

  const sectionDocs = [];
  const questionDocs = [];
  const optionDocs = [];

  for (let sIdx = 0; sIdx < sections.length; sIdx++) {
    const section = sections[sIdx];
    const sectionDoc = {
      _id: crypto.randomUUID(),
      order_index: sIdx,
      letter: section.letter || null,
      title: section.title,
      note: section.note || null,
      is_supplementary: section.isSupplementary ? 1 : 0,
      unscored: section.unscored ? 1 : 0,
      average_per_unit: section.averagePerUnit ? 1 : 0,
      visible_if_question_id: null,
      visible_if_value: section.visibleIfValue || null,
    };
    sectionDocs.push(sectionDoc);
    const sectionId = sectionDoc._id;
    let pendingDateQuestionId = null;

    for (let qIdx = 0; qIdx < (section.questions || []).length; qIdx++) {
      const question = section.questions[qIdx];
      const questionDoc = {
        _id: crypto.randomUUID(),
        section_id: sectionId,
        order_index: qIdx,
        type: question.type,
        label: question.label,
        hint: question.hint || null,
        required: question.required ? 1 : 0,
        unscored: question.unscored ? 1 : 0,
        average_across_selections: question.averageAcrossSelections ? 1 : 0,
        score_from_serial_age: question.scoreFromSerialAge ? 1 : 0,
        max_selections: question.maxSelections ?? null,
        max_selections_linked_question_id: null,
        derived_from_date_question_id: null,
        field_role: question.fieldRole || null,
        gate_role: question.gateRole || null,
        gate_value: question.gateValue || null,
        scale_min: question.scaleMin ?? null,
        scale_max: question.scaleMax ?? null,
        scale_min_label: question.scaleMinLabel || null,
        scale_max_label: question.scaleMaxLabel || null,
      };

      if (question.fieldRole === "has_aed_gate") hasAedGateQuestionId = questionDoc._id;
      if (question.isCountLink) pendingCountLinkQuestionId = questionDoc._id;
      if (question.maxSelectionsLinkedToPrevious && pendingCountLinkQuestionId) {
        questionDoc.max_selections_linked_question_id = pendingCountLinkQuestionId;
      }
      if (question.type === "date") pendingDateQuestionId = questionDoc._id;
      if (question.derivedFromPreviousDate && pendingDateQuestionId) {
        questionDoc.derived_from_date_question_id = pendingDateQuestionId;
      }

      questionDocs.push(questionDoc);
      const questionId = questionDoc._id;

      for (let oIdx = 0; oIdx < (question.options || []).length; oIdx++) {
        const option = question.options[oIdx];
        optionDocs.push({
          _id: crypto.randomUUID(),
          question_id: questionId,
          order_index: oIdx,
          value: option.value,
          label: option.label,
          sub: option.sub || null,
          points: option.points || 0,
          image_url: option.imageUrl || null,
          allow_free_text: option.allowFreeText ? 1 : 0,
        });
      }
    }

    if (section.visibleIfValue && hasAedGateQuestionId) {
      sectionDoc.visible_if_question_id = hasAedGateQuestionId;
    }
  }

  if (sectionDocs.length > 0) {
    await db.collection("form_sections").insertMany(sectionDocs);
    await db.collection("form_questions").insertMany(questionDocs);
    await db.collection("form_options").insertMany(optionDocs);
  }
}

export async function getFormSchema() {
  const d = await connectDB();
  const sections = await d.collection("form_sections").find({}).sort({ order_index: 1 }).toArray();
  const questions = await d.collection("form_questions").find({}).sort({ order_index: 1 }).toArray();
  const options = await d.collection("form_options").find({}).sort({ order_index: 1 }).toArray();

  const optionsByQuestion = new Map();
  for (const o of options) {
    const list = optionsByQuestion.get(o.question_id) || [];
    list.push({
      id: o._id,
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
      id: q._id,
      type: q.type,
      label: q.label,
      hint: q.hint,
      required: !!q.required,
      unscored: !!q.unscored,
      averageAcrossSelections: !!q.average_across_selections,
      scoreFromSerialAge: !!q.score_from_serial_age,
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
      options: optionsByQuestion.get(q._id) || [],
    });
    questionsBySection.set(q.section_id, list);
  }

  return {
    sections: sections.map((s) => ({
      id: s._id,
      letter: s.letter,
      title: s.title,
      note: s.note,
      isSupplementary: !!s.is_supplementary,
      unscored: !!s.unscored,
      averagePerUnit: !!s.average_per_unit,
      visibleIfQuestionId: s.visible_if_question_id,
      visibleIfValue: s.visible_if_value,
      questions: questionsBySection.get(s._id) || [],
    })),
  };
}

export async function createSection(fields) {
  const d = await connectDB();
  const maxOrder = await d.collection("form_sections").findOne({}, { sort: { order_index: -1 } });
  const orderIndex = (maxOrder?.order_index ?? -1) + 1;

  const doc = {
    _id: crypto.randomUUID(),
    order_index: orderIndex,
    letter: fields.letter || null,
    title: fields.title || "Untitled section",
    note: fields.note || null,
    is_supplementary: fields.isSupplementary ? 1 : 0,
    unscored: fields.unscored ? 1 : 0,
    average_per_unit: 0,
    visible_if_question_id: fields.visibleIfQuestionId || null,
    visible_if_value: fields.visibleIfValue || null,
  };

  await d.collection("form_sections").insertOne(doc);
  return doc._id;
}

export async function updateSection(id, fields) {
  const d = await connectDB();
  const cur = await d.collection("form_sections").findOne({ _id: id });
  if (!cur) return;

  const update = {};
  if (fields.letter !== undefined) update.letter = fields.letter;
  if (fields.title !== undefined) update.title = fields.title;
  if (fields.note !== undefined) update.note = fields.note;
  if (fields.isSupplementary != null) update.is_supplementary = fields.isSupplementary ? 1 : 0;
  if (fields.unscored != null) update.unscored = fields.unscored ? 1 : 0;
  if (fields.visibleIfQuestionId !== undefined) update.visible_if_question_id = fields.visibleIfQuestionId;
  if (fields.visibleIfValue !== undefined) update.visible_if_value = fields.visibleIfValue;

  await d.collection("form_sections").updateOne({ _id: id }, { $set: update });
}

// Nulls out every reference to a question that's about to be deleted,
// wherever else in the schema it's referenced by id — without this, a
// dangling id silently breaks whatever pointed at it instead of erroring:
// a section's visible_if_question_id left pointing at a deleted gate
// question makes isSectionVisible() permanently return false (the section
// just vanishes from the wizard for everyone); a question's
// max_selections_linked_question_id left dangling makes maxSelectionsFor()
// compute NaN > 0 -> false -> a permanent cap of 0 (that question becomes
// unanswerable); a derived_from_date_question_id left dangling just never
// resolves (see resolveDerivedAnswers), silently leaving that field blank
// forever. Clearing the link is the safe fallback in every case — an
// unlinked quantity question falls through to unrestricted/its own
// maxSelections instead of a stuck 0, and an unlinked section is simply
// always visible instead of always hidden.
async function clearQuestionReferences(d, questionIds) {
  if (questionIds.length === 0) return;
  await d.collection("form_sections").updateMany(
    { visible_if_question_id: { $in: questionIds } },
    { $set: { visible_if_question_id: null, visible_if_value: null } }
  );
  await d.collection("form_questions").updateMany(
    { max_selections_linked_question_id: { $in: questionIds } },
    { $set: { max_selections_linked_question_id: null } }
  );
  await d.collection("form_questions").updateMany(
    { derived_from_date_question_id: { $in: questionIds } },
    { $set: { derived_from_date_question_id: null } }
  );
}

export async function deleteSection(id) {
  const d = await connectDB();
  const questions = await d.collection("form_questions").find({ section_id: id }, { projection: { _id: 1 } }).toArray();
  const questionIds = questions.map((q) => q._id);
  await d.collection("form_sections").deleteOne({ _id: id });
  await d.collection("form_questions").deleteMany({ section_id: id });
  if (questionIds.length > 0) {
    await d.collection("form_options").deleteMany({ question_id: { $in: questionIds } });
  }
  await clearQuestionReferences(d, questionIds);
}

export async function moveSection(id, direction) {
  const d = await connectDB();
  const siblings = await d.collection("form_sections").find({}).sort({ order_index: 1 }).toArray();
  const idx = siblings.findIndex((s) => s._id === id);
  if (idx === -1) return;

  const swapIdx = direction === "up" ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= siblings.length) return;

  const a = siblings[idx];
  const b = siblings[swapIdx];

  await d.collection("form_sections").updateOne({ _id: a._id }, { $set: { order_index: b.order_index } });
  await d.collection("form_sections").updateOne({ _id: b._id }, { $set: { order_index: a.order_index } });
}

export async function createQuestion(sectionId, fields) {
  const d = await connectDB();
  // A stale admin tab (the section already deleted by another tab/admin
  // since this page loaded) would otherwise insert a question that
  // references a nonexistent section — it'd never surface in
  // getFormSchema (which only builds the tree top-down from sections) but
  // would sit in the DB forever as dead weight.
  const section = await d.collection("form_sections").findOne({ _id: sectionId });
  if (!section) return null;
  const maxOrder = await d.collection("form_questions").findOne({ section_id: sectionId }, { sort: { order_index: -1 } });
  const orderIndex = (maxOrder?.order_index ?? -1) + 1;

  const doc = {
    _id: crypto.randomUUID(),
    section_id: sectionId,
    order_index: orderIndex,
    type: fields.type || "radio",
    label: fields.label || "Untitled question",
    hint: fields.hint || null,
    required: fields.required ? 1 : 0,
    unscored: fields.unscored ? 1 : 0,
    average_across_selections: fields.averageAcrossSelections ? 1 : 0,
    score_from_serial_age: fields.scoreFromSerialAge ? 1 : 0,
    max_selections: fields.maxSelections ?? null,
    max_selections_linked_question_id: fields.maxSelectionsLinkedQuestionId ?? null,
    derived_from_date_question_id: fields.derivedFromDateQuestionId ?? null,
    field_role: fields.fieldRole || null,
    gate_role: fields.gateRole || null,
    gate_value: fields.gateValue || null,
    scale_min: fields.scaleMin ?? null,
    scale_max: fields.scaleMax ?? null,
    scale_min_label: fields.scaleMinLabel || null,
    scale_max_label: fields.scaleMaxLabel || null,
  };

  await d.collection("form_questions").insertOne(doc);
  return doc._id;
}

export async function updateQuestion(id, fields) {
  const d = await connectDB();
  const cur = await d.collection("form_questions").findOne({ _id: id });
  if (!cur) return;

  const update = {};
  if (fields.type !== undefined) update.type = fields.type;
  if (fields.label !== undefined) update.label = fields.label;
  if (fields.hint !== undefined) update.hint = fields.hint;
  if (fields.required != null) update.required = fields.required ? 1 : 0;
  if (fields.unscored != null) update.unscored = fields.unscored ? 1 : 0;
  if (fields.maxSelections !== undefined) update.max_selections = fields.maxSelections;
  if (fields.maxSelectionsLinkedQuestionId !== undefined) update.max_selections_linked_question_id = fields.maxSelectionsLinkedQuestionId;
  if (fields.derivedFromDateQuestionId !== undefined) update.derived_from_date_question_id = fields.derivedFromDateQuestionId;
  if (fields.fieldRole !== undefined) update.field_role = fields.fieldRole;
  if (fields.gateRole !== undefined) update.gate_role = fields.gateRole;
  if (fields.gateValue !== undefined) update.gate_value = fields.gateValue;
  if (fields.scaleMin !== undefined) update.scale_min = fields.scaleMin;
  if (fields.scaleMax !== undefined) update.scale_max = fields.scaleMax;
  if (fields.scaleMinLabel !== undefined) update.scale_min_label = fields.scaleMinLabel;
  if (fields.scaleMaxLabel !== undefined) update.scale_max_label = fields.scaleMaxLabel;

  await d.collection("form_questions").updateOne({ _id: id }, { $set: update });
}

export async function deleteQuestion(id) {
  const d = await connectDB();
  await d.collection("form_questions").deleteOne({ _id: id });
  await d.collection("form_options").deleteMany({ question_id: id });
  await clearQuestionReferences(d, [id]);
}

export async function moveQuestion(id, direction) {
  const d = await connectDB();
  const q = await d.collection("form_questions").findOne({ _id: id });
  if (!q) return;

  const siblings = await d.collection("form_questions").find({ section_id: q.section_id }).sort({ order_index: 1 }).toArray();
  const idx = siblings.findIndex((s) => s._id === id);
  if (idx === -1) return;

  const swapIdx = direction === "up" ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= siblings.length) return;

  const a = siblings[idx];
  const b = siblings[swapIdx];

  await d.collection("form_questions").updateOne({ _id: a._id }, { $set: { order_index: b.order_index } });
  await d.collection("form_questions").updateOne({ _id: b._id }, { $set: { order_index: a.order_index } });
}

export async function createOption(questionId, fields) {
  const d = await connectDB();
  // Same reasoning as createQuestion above — don't attach an option to a
  // question id that no longer exists.
  const question = await d.collection("form_questions").findOne({ _id: questionId });
  if (!question) return null;
  const maxOrder = await d.collection("form_options").findOne({ question_id: questionId }, { sort: { order_index: -1 } });
  const orderIndex = (maxOrder?.order_index ?? -1) + 1;

  const doc = {
    _id: crypto.randomUUID(),
    question_id: questionId,
    order_index: orderIndex,
    value: fields.value || `option-${Date.now()}`,
    label: fields.label || "Untitled option",
    sub: fields.sub || null,
    points: fields.points || 0,
    image_url: fields.imageUrl || null,
    allow_free_text: fields.allowFreeText ? 1 : 0,
  };

  await d.collection("form_options").insertOne(doc);
  return doc._id;
}

export async function updateOption(id, fields) {
  const d = await connectDB();
  const cur = await d.collection("form_options").findOne({ _id: id });
  if (!cur) return;

  const update = {};
  if (fields.value !== undefined) update.value = fields.value;
  if (fields.label !== undefined) update.label = fields.label;
  if (fields.sub !== undefined) update.sub = fields.sub;
  if (fields.points !== undefined) update.points = fields.points;
  if (fields.imageUrl !== undefined) update.image_url = fields.imageUrl;
  if (fields.allowFreeText != null) update.allow_free_text = fields.allowFreeText ? 1 : 0;

  await d.collection("form_options").updateOne({ _id: id }, { $set: update });
}

export async function deleteOption(id) {
  const d = await connectDB();
  await d.collection("form_options").deleteOne({ _id: id });
}

export async function moveOption(id, direction) {
  const d = await connectDB();
  const o = await d.collection("form_options").findOne({ _id: id });
  if (!o) return;

  const siblings = await d.collection("form_options").find({ question_id: o.question_id }).sort({ order_index: 1 }).toArray();
  const idx = siblings.findIndex((s) => s._id === id);
  if (idx === -1) return;

  const swapIdx = direction === "up" ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= siblings.length) return;

  const a = siblings[idx];
  const b = siblings[swapIdx];

  await d.collection("form_options").updateOne({ _id: a._id }, { $set: { order_index: b.order_index } });
  await d.collection("form_options").updateOne({ _id: b._id }, { $set: { order_index: a.order_index } });
}

export async function getAllQuestionsFlat() {
  const d = await connectDB();
  return await d.collection("form_questions").find({}).sort({ _id: 1 }).toArray().then(docs =>
    docs.map(doc => ({ id: doc._id, label: doc.label, type: doc.type, field_role: doc.field_role }))
  );
}

export async function insertSubmission({ answers, scored, identity, prize }) {
  const d = await connectDB();
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  let certificateNumber = null;
  if (scored.qualifiesForCertificate) {
    certificateNumber = await nextCertificateNumber(d);
  }

  const doc = {
    _id: id,
    created_at: createdAt,
    hotel: identity.hotel || "",
    first_name: identity.firstName || "",
    last_name: identity.lastName || "",
    email: normalizeEmail(identity.email),
    phone: identity.phone || "",
    has_aed: identity.hasAED || "",
    total_points: scored.total.points,
    total_max: scored.total.max,
    prepared_points: scored.prepared.points,
    prepared_max: scored.prepared.max,
    answers_json: JSON.stringify(answers),
    prize: prize || null,
    certificate_number: certificateNumber,
    delivery_name: null,
    delivery_address1: null,
    delivery_address2: null,
    delivery_city: null,
    delivery_state: null,
    delivery_postal_code: null,
    delivery_country: null,
    delivery_notes: null,
    delivery_submitted_at: null,
  };

  await d.collection("submissions").insertOne(doc);
  return id;
}

export async function getSubmission(id) {
  const d = await connectDB();
  const row = await d.collection("submissions").findOne({ _id: id });
  if (!row) return null;
  return { ...row, id: row._id, answers: JSON.parse(row.answers_json) };
}

export function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

export async function getSubmissionByEmail(email) {
  const d = await connectDB();
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  return await d.collection("submissions").findOne({ email: normalized }) || null;
}

// Revisiting the report link and editing a saved address is deliberate
// (see DeliveryAddressCard.jsx) — that stays working exactly as before.
// What was missing was any record of what an address *was* before an
// edit overwrote it, on an endpoint with no ownership check beyond
// knowing the submission's own id. This doesn't lock editing (that would
// break the intended re-edit flow); it keeps every prior version in
// delivery_history so a later dispute ("we shipped to the address you
// gave us") has something to point to.
export async function saveDeliveryAddress(id, { name, address1, address2, city, state, postalCode, country, notes }) {
  const d = await connectDB();
  const current = await d.collection("submissions").findOne({ _id: id });
  if (!current) return false;

  const previousSnapshot =
    current.delivery_submitted_at != null
      ? {
          name: current.delivery_name,
          address1: current.delivery_address1,
          address2: current.delivery_address2,
          city: current.delivery_city,
          state: current.delivery_state,
          postal_code: current.delivery_postal_code,
          country: current.delivery_country,
          notes: current.delivery_notes,
          submitted_at: current.delivery_submitted_at,
          replaced_at: new Date().toISOString(),
        }
      : null;

  const update = {
    $set: {
      delivery_name: name || "",
      delivery_address1: address1 || "",
      delivery_address2: address2 || "",
      delivery_city: city || "",
      delivery_state: state || "",
      delivery_postal_code: postalCode || "",
      delivery_country: country || "",
      delivery_notes: notes || "",
      delivery_submitted_at: new Date().toISOString(),
    },
  };
  if (previousSnapshot) update.$push = { delivery_history: previousSnapshot };

  const result = await d.collection("submissions").updateOne({ _id: id }, update);
  return result.matchedCount > 0;
}

export async function deleteSubmission(id) {
  const d = await connectDB();
  const result = await d.collection("submissions").deleteOne({ _id: id });
  return result.deletedCount > 0;
}

export async function listSubmissions() {
  const d = await connectDB();
  return await d.collection("submissions").find({}).sort({ created_at: -1 }).toArray().then(docs =>
    docs.map(doc => ({
      id: doc._id,
      created_at: doc.created_at,
      hotel: doc.hotel,
      first_name: doc.first_name,
      last_name: doc.last_name,
      email: doc.email,
      phone: doc.phone,
      has_aed: doc.has_aed,
      total_points: doc.total_points,
      total_max: doc.total_max,
      prepared_points: doc.prepared_points,
      prepared_max: doc.prepared_max,
    }))
  );
}

export async function listSubmissionsFull() {
  const d = await connectDB();
  return await d.collection("submissions").find({}).sort({ created_at: -1 }).toArray().then(docs =>
    docs.map(doc => ({ ...doc, id: doc._id, answers: JSON.parse(doc.answers_json) }))
  );
}

export async function createAdminSession(token, ttlMs) {
  const d = await connectDB();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlMs);

  await d.collection("admin_sessions").deleteMany({ expires_at: { $lt: now.toISOString() } });
  await d.collection("admin_sessions").insertOne({
    _id: hashToken(token),
    created_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
  });
}

export async function isValidAdminSession(token) {
  if (!token) return false;
  const d = await connectDB();
  const row = await d.collection("admin_sessions").findOne({ _id: hashToken(token) });
  if (!row) return false;
  return new Date(row.expires_at).getTime() > Date.now();
}

export async function deleteAdminSession(token) {
  const d = await connectDB();
  await d.collection("admin_sessions").deleteOne({ _id: hashToken(token) });
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export default connectDB;
