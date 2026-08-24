import { isValidAedSerialFormat, aedSerialFormatHint } from "./aedSerialDate";

// Generic scoring engine — operates purely on the DB-defined schema (sections,
// questions, options) and a plain answers map, so editing the form in the
// admin builder automatically changes what gets scored, with no code changes.
//
// Answer shapes, keyed by question id:
//   radio | select : { value: string, freeText: string }
//   checkbox       : { selections: { [optionValue]: boolean }, freeText: { [optionValue]: string } }
//   quantity       : { quantities: { [optionValue]: number }, freeText: { [optionValue]: string } }
//                    — like checkbox, but each option can be picked more than once (e.g. two
//                    units of the same AED model). The selection cap is a target *sum*, not a
//                    count of distinct options.
//   text/email/tel/date : string
//   scale          : number (always unscored — self-rated confidence, not audited)

export function maxSelectionsFor(question, answers) {
  if (question.maxSelectionsLinkedQuestionId != null) {
    const linked = answers[question.maxSelectionsLinkedQuestionId];
    const n = parseInt(linked?.value, 10);
    if (n > 0) return n;
    return 0;
  }
  if (question.maxSelections != null) return question.maxSelections;
  return Infinity;
}

// Standard expiry-tier boundaries, used whenever a radio question is linked to a
// date question via `derivedFromDateQuestionId` — the date is the single source of
// truth, and the tier (and its points) are derived from it automatically, never
// entered by hand. Matches the option `value`s used throughout the seeded form:
// gt2y / 1to2y / gt6m / within6m / expired.
export function computeExpiryTierValue(dateStr, today = new Date()) {
  if (!dateStr) return null;
  const target = new Date(dateStr);
  if (Number.isNaN(target.getTime())) return null;

  const msPerDay = 24 * 60 * 60 * 1000;
  const days = Math.round((target - today) / msPerDay);

  if (days < 0) return "expired";
  if (days < 183) return "within6m"; // < ~6 months
  if (days < 365) return "gt6m"; // 6 months - 1 year
  if (days < 730) return "1to2y"; // 1-2 years
  return "gt2y"; // 2+ years
}

// Fills in any question whose value is derived from a paired date question
// (rather than picked by hand), by recomputing it from that date question's
// current answer. Safe to call repeatedly — it's the single source of truth,
// called both live in the wizard and again server-side before scoring.
export function resolveDerivedAnswers(schema, answers) {
  const resolved = { ...answers };
  for (const section of schema.sections) {
    for (const q of section.questions) {
      if (!q.derivedFromDateQuestionId) continue;
      const dateAnswer = resolved[q.derivedFromDateQuestionId];
      const tier = computeExpiryTierValue(dateAnswer);
      if (!tier) continue;
      const opt = q.options.find((o) => o.value === tier);
      if (opt) resolved[q.id] = { value: opt.value, freeText: "" };
    }
  }
  return resolved;
}

// The question whose selected count gates how many physical AED units the
// responder is asked about — found structurally (whatever question a
// quantity/checkbox question is linked to via maxSelectionsLinkedQuestionId),
// not by hardcoding an id, so it keeps working if the form is re-edited.
export function findUnitCountQuestionId(schema) {
  for (const section of schema.sections) {
    for (const q of section.questions) {
      if (q.maxSelectionsLinkedQuestionId != null) return q.maxSelectionsLinkedQuestionId;
    }
  }
  return null;
}

// The AED model(s) actually reported on site — read off the same quantity
// question findUnitCountQuestionId's link points *at* (found the same
// structural way, not by hardcoding an id), so the Expiry Status reference
// photos can be filtered to only the brand(s) the responder selected instead
// of showing every supported model.
export function getSelectedAedModels(schema, answers) {
  for (const section of schema.sections) {
    for (const q of section.questions) {
      if (q.maxSelectionsLinkedQuestionId != null) {
        const quantities = answers[q.id]?.quantities || {};
        return Object.keys(quantities).filter((k) => quantities[k] > 0);
      }
    }
  }
  return [];
}

// Human-readable brand name per model value (e.g. "zollPlus" -> "ZOLL AED
// Plus"), read straight off the same quantity question's own option labels
// rather than a separately-maintained name list — whatever the admin edits
// there (via the form builder) stays the single source of truth for what a
// model is actually called.
export function getModelLabelMap(schema) {
  for (const section of schema.sections) {
    for (const q of section.questions) {
      if (q.maxSelectionsLinkedQuestionId != null) {
        return Object.fromEntries(q.options.map((o) => [o.value, o.label]));
      }
    }
  }
  return {};
}

// Same quantity answer as getSelectedAedModels, but expanded into one entry
// per physical unit instead of one per distinct model — e.g. quantities
// { frx: 2, zollPlus: 1 } becomes ["frx", "frx", "zollPlus"]. This gives the
// Expiry Status section (which asks about unit "(1)", "(2)", "(3)"...) a
// deterministic, sequential mapping from unit number to model, so "AED (1)"
// always shows unit 1's brand photos and "AED (2)" always shows unit 2's,
// instead of every unit showing every selected brand's photos.
export function getAedModelSequence(schema, answers) {
  for (const section of schema.sections) {
    for (const q of section.questions) {
      if (q.maxSelectionsLinkedQuestionId != null) {
        const quantities = answers[q.id]?.quantities || {};
        const sequence = [];
        for (const o of q.options) {
          const qty = quantities[o.value] || 0;
          for (let i = 0; i < qty; i++) sequence.push(o.value);
        }
        return sequence;
      }
    }
  }
  return [];
}

const UNIT_TEMPLATE_RE = /\(2\)/;

// The Expiry Status section only ever defined two static unit blocks: "(1)"
// and a "(2)" template (originally seeded as optional/unscored, back when a
// second AED was a maybe). This adapts that to whatever the responder
// actually reported via the AED count question: exactly 1 unit drops the
// "(2)" block entirely (nothing to ask about a unit that doesn't exist); 2+
// clones the "(2)" block as many times as needed, renumbering labels and
// re-linking each clone's derived-date question to its own sibling clone
// (not the original "(2)" one). Clones are purely in-memory — nothing is
// written back to the form_questions table.
//
// Every unit from 2 up to the reported count is forced required + scored
// here, overriding whatever the "(2)" template's own required/unscored flags
// say: the responder has already told us this unit physically exists (that's
// what the count question is for), so treating it as optional the way an
// *unreported*, maybe-there unit would be is misleading — it under-scores a
// real AED's expiry status. Only units beyond the reported count are ever
// absent, and those are dropped rather than left "optional".
export function expandUnitQuestions(schema, answers) {
  const countQuestionId = findUnitCountQuestionId(schema);
  const count = countQuestionId != null ? parseInt(answers[countQuestionId]?.value, 10) : NaN;
  if (!Number.isFinite(count)) return schema; // not answered yet — leave the default (1)/(2) blocks alone

  const makeReported = (q) => ({ ...q, required: true, ...("unscored" in q ? { unscored: false } : {}) });

  return {
    ...schema,
    sections: schema.sections.map((section) => {
      const template = section.questions.filter((q) => UNIT_TEMPLATE_RE.test(q.label));
      if (template.length === 0) return section;

      if (count <= 1) {
        const templateIds = new Set(template.map((q) => q.id));
        return { ...section, questions: section.questions.filter((q) => !templateIds.has(q.id)) };
      }

      const baseQuestions = section.questions.map((q) => (UNIT_TEMPLATE_RE.test(q.label) ? makeReported(q) : q));
      if (count === 2) return { ...section, questions: baseQuestions };

      const extraQuestions = [];
      for (let unit = 3; unit <= count; unit++) {
        const idMap = new Map();
        const clones = template.map((q) => {
          const cloneId = `${q.id}-u${unit}`;
          idMap.set(q.id, cloneId);
          return makeReported({ ...q, id: cloneId, label: q.label.replace("(2)", `(${unit})`) });
        });
        clones.forEach((c) => {
          if (c.derivedFromDateQuestionId != null && idMap.has(c.derivedFromDateQuestionId)) {
            c.derivedFromDateQuestionId = idMap.get(c.derivedFromDateQuestionId);
          }
        });
        extraQuestions.push(...clones);
      }

      const insertAt = section.questions.lastIndexOf(template[template.length - 1]) + 1;
      const questions = [...baseQuestions];
      questions.splice(insertAt, 0, ...extraQuestions);
      return { ...section, questions };
    }),
  };
}

export function isSectionVisible(section, answers) {
  if (!section.visibleIfQuestionId) return true;
  const gate = answers[section.visibleIfQuestionId];
  return gate?.value === section.visibleIfValue;
}

export function questionMax(question) {
  if (question.unscored) return 0;
  if (question.type === "radio" || question.type === "select") {
    return question.options.reduce((m, o) => Math.max(m, o.points || 0), 0);
  }
  if (question.type === "checkbox" || question.type === "quantity") {
    // Cap isn't answer-dependent for a *display* max — show the sum of every option's
    // points as the ceiling; the linked/fixed cap is enforced live in the wizard UI instead.
    return question.options.reduce((s, o) => s + (o.points || 0), 0);
  }
  return 0;
}

export function questionPoints(question, answer) {
  if (question.unscored) return 0;
  if (question.type === "radio" || question.type === "select") {
    if (!answer?.value) return 0;
    const opt = question.options.find((o) => o.value === answer.value);
    return opt?.points || 0;
  }
  if (question.type === "checkbox") {
    const selections = answer?.selections || {};
    return question.options.reduce((s, o) => s + (selections[o.value] ? o.points || 0 : 0), 0);
  }
  if (question.type === "quantity") {
    const quantities = answer?.quantities || {};
    return question.options.reduce((s, o) => s + (quantities[o.value] || 0) * (o.points || 0), 0);
  }
  return 0;
}

export function scoreSection(section, answers) {
  const visible = isSectionVisible(section, answers);
  let points = 0;
  let max = 0;
  for (const q of section.questions) {
    max += questionMax(q);
    if (visible) points += questionPoints(q, answers[q.id]);
  }
  return { points, max, visible };
}

// Returns { sections: [{id,title,letter,isSupplementary,unscored,points,max,visible}],
//           prepared:{points,max}, supplementary:{points,max}, total:{points,max}, qualifiesForCertificate }
export function scoreSubmission(schema, answers) {
  const sectionScores = schema.sections.map((s) => ({
    id: s.id,
    title: s.title,
    letter: s.letter,
    isSupplementary: s.isSupplementary,
    unscored: s.unscored,
    ...scoreSection(s, answers),
  }));

  const scored = sectionScores.filter((s) => !s.unscored);
  const prepared = scored.filter((s) => !s.isSupplementary).reduce((a, s) => ({ points: a.points + s.points, max: a.max + s.max }), { points: 0, max: 0 });
  const supplementary = scored.filter((s) => s.isSupplementary).reduce((a, s) => ({ points: a.points + s.points, max: a.max + s.max }), { points: 0, max: 0 });
  const total = { points: prepared.points + supplementary.points, max: prepared.max + supplementary.max };

  const gateQuestions = [];
  for (const s of schema.sections) {
    for (const q of s.questions) {
      if (q.gateRole === "certificate") gateQuestions.push(q);
    }
  }
  const qualifiesForCertificate =
    gateQuestions.length > 0 && gateQuestions.every((q) => answers[q.id]?.value === q.gateValue);

  return { sections: sectionScores, prepared, supplementary, total, qualifiesForCertificate };
}

export function extractIdentity(schema, answers) {
  const identity = { hotel: "", firstName: "", lastName: "", email: "", phone: "", hasAED: "" };
  for (const s of schema.sections) {
    for (const q of s.questions) {
      const a = answers[q.id];
      if (q.fieldRole === "hotel") identity.hotel = a?.value === "Other" ? a?.freeText || "Other" : a?.value || "";
      if (q.fieldRole === "first_name") identity.firstName = a || "";
      if (q.fieldRole === "last_name") identity.lastName = a || "";
      if (q.fieldRole === "email") identity.email = a || "";
      if (q.fieldRole === "phone") identity.phone = a || "";
      if (q.fieldRole === "has_aed_gate") identity.hasAED = a?.value || "";
    }
  }
  return identity;
}

// Aggregates a batch of submissions against the *current* schema (so a form
// edited after old submissions came in still scores them consistently, same
// as an individual report does). Feeds the admin analytics dashboard:
// overview stats, per-section and per-question averages (the latter is what
// surfaces "which specific checks fail most often" across every property),
// a per-hotel leaderboard, and a submissions-over-time trend.
export function aggregateSubmissions(schema, submissions) {
  let preparedPctSum = 0;
  let preparedScoredCount = 0;
  let totalPctSum = 0;
  let aedInstalledCount = 0;
  let certificateCount = 0;

  const sectionAgg = new Map();
  const questionAgg = new Map();
  const hotelAgg = new Map();
  const dayAgg = new Map();

  for (const sub of submissions) {
    const answers = sub.answers;
    // Each submission may have reported a different number of AED units, so
    // the expansion (and the required/scored override it now applies to
    // every reported unit — see expandUnitQuestions) has to be recomputed
    // per submission rather than once against the shared `schema` param.
    const subSchema = expandUnitQuestions(schema, answers);
    const scored = scoreSubmission(subSchema, answers);
    const identity = extractIdentity(subSchema, answers);

    if (scored.prepared.max > 0) {
      preparedPctSum += (scored.prepared.points / scored.prepared.max) * 100;
      preparedScoredCount++;
    }
    if (scored.total.max > 0) totalPctSum += (scored.total.points / scored.total.max) * 100;
    if (identity.hasAED === "yes") aedInstalledCount++;
    if (scored.qualifiesForCertificate) certificateCount++;

    for (const s of scored.sections) {
      if (s.unscored || s.isSupplementary || !s.visible) continue;
      const cur = sectionAgg.get(s.id) || { title: s.title, pointsSum: 0, maxSum: 0 };
      cur.pointsSum += s.points;
      cur.maxSum += s.max;
      sectionAgg.set(s.id, cur);
    }

    for (const section of subSchema.sections) {
      if (!isSectionVisible(section, answers)) continue;
      for (const q of section.questions) {
        if (q.unscored) continue;
        const max = questionMax(q);
        if (max <= 0) continue;
        const points = questionPoints(q, answers[q.id]);
        const cur = questionAgg.get(q.id) || { label: q.label, sectionTitle: section.title, pointsSum: 0, maxSum: 0, responses: 0 };
        cur.pointsSum += points;
        cur.maxSum += max;
        cur.responses += 1;
        questionAgg.set(q.id, cur);
      }
    }

    const hotel = identity.hotel || "Unknown";
    const hcur = hotelAgg.get(hotel) || { hotel, count: 0, preparedPointsSum: 0, preparedMaxSum: 0 };
    hcur.count++;
    hcur.preparedPointsSum += scored.prepared.points;
    hcur.preparedMaxSum += scored.prepared.max;
    hotelAgg.set(hotel, hcur);

    const day = (sub.created_at || "").slice(0, 10);
    if (day) {
      const dcur = dayAgg.get(day) || { date: day, count: 0, preparedPointsSum: 0, preparedMaxSum: 0 };
      dcur.count++;
      dcur.preparedPointsSum += scored.prepared.points;
      dcur.preparedMaxSum += scored.prepared.max;
      dayAgg.set(day, dcur);
    }
  }

  const count = submissions.length;
  const overview = {
    count,
    avgPreparedPct: preparedScoredCount ? Math.round(preparedPctSum / preparedScoredCount) : 0,
    avgTotalPct: count ? Math.round(totalPctSum / count) : 0,
    aedInstalledCount,
    aedInstalledPct: count ? Math.round((aedInstalledCount / count) * 100) : 0,
    certificateCount,
    certificateRate: count ? Math.round((certificateCount / count) * 100) : 0,
  };

  const sectionAverages = [...sectionAgg.values()].map((s) => ({
    title: s.title,
    avgPct: s.maxSum > 0 ? Math.round((s.pointsSum / s.maxSum) * 100) : 0,
  }));

  const weakestQuestions = [...questionAgg.values()]
    .map((q) => ({
      label: q.label,
      sectionTitle: q.sectionTitle,
      avgPct: q.maxSum > 0 ? Math.round((q.pointsSum / q.maxSum) * 100) : 0,
      responses: q.responses,
    }))
    .sort((a, b) => a.avgPct - b.avgPct);

  const hotelLeaderboard = [...hotelAgg.values()]
    .map((h) => ({
      hotel: h.hotel,
      count: h.count,
      avgPreparedPct: h.preparedMaxSum > 0 ? Math.round((h.preparedPointsSum / h.preparedMaxSum) * 100) : 0,
    }))
    .sort((a, b) => b.avgPreparedPct - a.avgPreparedPct);

  const scoreTrend = [...dayAgg.values()]
    .map((d) => ({
      date: d.date,
      count: d.count,
      avgPreparedPct: d.preparedMaxSum > 0 ? Math.round((d.preparedPointsSum / d.preparedMaxSum) * 100) : 0,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return { overview, sectionAverages, weakestQuestions, hotelLeaderboard, scoreTrend };
}

// Practical (not full-RFC5322) email pattern — matches what browsers accept
// for <input type="email">, so client and server agree on what's valid.
const EMAIL_RE = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

export function isValidEmail(value) {
  return EMAIL_RE.test(String(value || "").trim());
}

// Every hotel in this campaign is in India, so the phone field is validated
// as an Indian mobile number: exactly 10 digits starting 6-9, once a leading
// +91/91 country code or a domestic trunk 0 is stripped off. Also rejects
// the handful of "technically 10 digits" patterns responders reach for when
// they don't want to give a real number.
const FAKE_MOBILE_PATTERNS = new Set(["1234567890", "0123456789", "9876543210", "9123456780"]);

export function isValidIndianMobile(value) {
  let digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  if (!/^[6-9]\d{9}$/.test(digits)) return false;
  if (/^(\d)\1{9}$/.test(digits)) return false; // 9999999999, 0000000000, etc.
  if (FAKE_MOBILE_PATTERNS.has(digits)) return false;
  return true;
}

// Same "(N)" convention as unitNumberFromLabel in components/ReferenceGuide.jsx
// — duplicated rather than imported, since that file is a client component and
// this one runs on both client and server.
function unitNumberFromLabel(label) {
  const m = /\((\d+)\)/.exec(label || "");
  return m ? parseInt(m[1], 10) : null;
}

function validateQuestion(q, answers, schema) {
  if (!q.required) return null;
  const a = answers[q.id];
  if (q.type === "checkbox") {
    const selections = a?.selections || {};
    const count = Object.values(selections).filter(Boolean).length;
    const limit = maxSelectionsFor(q, answers);
    if (Number.isFinite(limit) && limit > 0 && count < limit) {
      return `"${q.label}": select ${limit} option${limit === 1 ? "" : "s"} (currently ${count}).`;
    }
    if (count === 0) return `"${q.label}": select at least one option.`;
    for (const o of q.options) {
      if (o.allowFreeText && selections[o.value] && !a?.freeText?.[o.value]?.trim()) {
        return `"${q.label}": enter the free-text detail for "${o.label}".`;
      }
    }
  } else if (q.type === "quantity") {
    const quantities = a?.quantities || {};
    const total = Object.values(quantities).reduce((s, n) => s + (n || 0), 0);
    const limit = maxSelectionsFor(q, answers);
    if (Number.isFinite(limit) && limit > 0 && total !== limit) {
      return `"${q.label}": quantities must add up to ${limit} (currently ${total}).`;
    }
    if (total === 0) return `"${q.label}": enter at least one quantity.`;
    for (const o of q.options) {
      if (o.allowFreeText && quantities[o.value] > 0 && !a?.freeText?.[o.value]?.trim()) {
        return `"${q.label}": enter the free-text detail for "${o.label}".`;
      }
    }
  } else if (q.type === "radio" || q.type === "select") {
    if (!a?.value) {
      if (q.derivedFromDateQuestionId) return `Enter the date above so "${q.label}" can be auto-detected.`;
      return `"${q.label}": this question is required.`;
    }
    const opt = q.options.find((o) => o.value === a.value);
    if (opt?.allowFreeText && !a?.freeText?.trim()) {
      return `"${q.label}": enter the free-text detail for "${opt.label}".`;
    }
  } else if (q.type === "scale") {
    if (a == null) return `"${q.label}": this question is required.`;
  } else {
    if (!a || !String(a).trim()) return `"${q.label}": this question is required.`;
    if (q.type === "email" && !isValidEmail(a)) return `"${q.label}": enter a valid email address.`;
    if (q.type === "tel" && !isValidIndianMobile(a)) return `"${q.label}": enter a valid 10-digit mobile number.`;
    // Only checked against the three brands with an independently-verified
    // serial format (see lib/aedSerialDate.js) — a model with no documented
    // scheme never blocks submission over this, since there's nothing
    // verified to check it against, and schema is required to look up which
    // unit's model this field belongs to (absent in a couple of call sites
    // that only ever validate a single already-known question).
    if (q.type === "text" && schema && /serial/i.test(q.label)) {
      const unit = unitNumberFromLabel(q.label);
      const model = unit != null ? getAedModelSequence(schema, answers)[unit - 1] : null;
      if (model && !isValidAedSerialFormat(model, a)) {
        const brand = getModelLabelMap(schema)[model] || "this AED";
        const hint = aedSerialFormatHint(model);
        return `"${q.label}": doesn't match ${brand}'s serial number format${hint ? ` (expected: ${hint})` : ""}.`;
      }
    }
  }
  return null;
}

// Returns { questionId, message } (so the wizard can scroll to/highlight the
// actual invalid field, not just show a message somewhere on screen) or null.
export function validateSection(section, answers, schema) {
  for (const q of section.questions) {
    const message = validateQuestion(q, answers, schema);
    if (message) return { questionId: q.id, message };
  }
  return null;
}

export function validateAnswers(schema, answers) {
  for (const section of schema.sections) {
    if (!isSectionVisible(section, answers)) continue;
    const err = validateSection(section, answers, schema);
    if (err) return err;
  }
  return null;
}
