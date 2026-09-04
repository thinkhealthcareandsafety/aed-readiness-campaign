import { isValidAedSerialFormat, aedSerialFormatHint, aedAgeStatus } from "./aedSerialDate";
import { isValidInternationalPhone } from "./phoneCountries";

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

// A quantity/checkbox question capped by another question's value (e.g.
// "how many AEDs" gating the model quantities below it) can end up over its
// own limit the moment that other question's answer *decreases* — nothing
// about picking 4 units then changing the count dropdown to 1 ever touched
// the 4 units already selected, so they just sat there, still selected,
// silently contradicting the new limit (and, worse, expandUnitQuestions
// below drives the whole rest of the form off this question's own total,
// not off the linked question's raw value — so the downstream Physical
// Status/Expiry Status sections stayed expanded to 4 units too). Called
// centrally on every answers change (see setAnswers in AuditWizard.jsx) so
// this self-heals regardless of which question actually changed, trimming
// deterministically from the end of each option list so the same units
// stay selected/kept as before, just fewer of them.
export function reconcileLinkedSelections(schema, answers) {
  let result = answers;
  for (const section of schema.sections) {
    for (const q of section.questions) {
      if (q.maxSelectionsLinkedQuestionId == null) continue;
      const limit = maxSelectionsFor(q, result);
      if (!Number.isFinite(limit)) continue;
      if (q.type === "quantity") {
        const cur = result[q.id];
        if (!cur?.quantities) continue;
        let running = 0;
        let changed = false;
        const quantities = {};
        for (const o of q.options) {
          const want = cur.quantities[o.value] || 0;
          const allowed = Math.max(0, Math.min(want, limit - running));
          if (allowed !== want) changed = true;
          if (allowed > 0) quantities[o.value] = allowed;
          running += allowed;
        }
        if (changed) result = { ...result, [q.id]: { ...cur, quantities } };
      } else if (q.type === "checkbox") {
        const cur = result[q.id];
        if (!cur?.selections) continue;
        let running = 0;
        let changed = false;
        const selections = {};
        for (const o of q.options) {
          const want = !!cur.selections[o.value];
          const allow = want && running < limit;
          if (allow !== want) changed = true;
          selections[o.value] = allow;
          if (allow) running++;
        }
        if (changed) result = { ...result, [q.id]: { ...cur, selections } };
      }
    }
  }
  return result;
}

// Standard expiry-tier boundaries, used whenever a radio question is linked to a
// date question via `derivedFromDateQuestionId` — the date is the single source of
// truth, and the tier (and its points) are derived from it automatically, never
// entered by hand. Matches the option `value`s used throughout the seeded form:
// gt2y / 1to2y / gt6m / within6m / within1m / within1w / expired.
// within1w/within1m split out of what used to be one flat "within6m" bucket —
// an expiry 5 days out and one 5 months out used to show the identical badge,
// which hid exactly the cases that need the most urgent follow-up.
export function computeExpiryTierValue(dateStr, today = new Date()) {
  if (!dateStr) return null;
  const target = new Date(dateStr);
  if (Number.isNaN(target.getTime())) return null;

  const msPerDay = 24 * 60 * 60 * 1000;
  const days = Math.round((target - today) / msPerDay);

  if (days < 0) return "expired";
  if (days < 7) return "within1w"; // < 1 week
  if (days < 30) return "within1m"; // 1 week - 1 month
  if (days < 183) return "within6m"; // 1 month - ~6 months
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
// The seeded dropdown only ever offers 1-10, but this clamp is
// independent, deeper defense-in-depth: validateAnswers now rejects an
// AED-count value that isn't one of the question's real options (see
// validateQuestion above), but this loop has no business exploding past a
// sane ceiling even if that check is ever bypassed or the form is
// re-edited to offer a much larger range — a person genuinely doesn't
// audit 500 physical defibrillators in one sitting.
const MAX_UNITS = 50;

export function expandUnitQuestions(schema, answers) {
  const countQuestionId = findUnitCountQuestionId(schema);
  const rawCount = countQuestionId != null ? parseInt(answers[countQuestionId]?.value, 10) : NaN;
  if (!Number.isFinite(rawCount)) return schema; // not answered yet — leave the default (1)/(2) blocks alone
  const count = Math.min(Math.max(rawCount, 0), MAX_UNITS);

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
          // The "(2)" template's own fieldRole (e.g. "battery_attached_2",
          // see lib/inspectionChecklist.js's fieldRoleFor) always ends in
          // "_2" by convention — rewritten to "_N" per clone so auto
          // inspection's per-unit results land on the right unit's
          // question instead of every unit 3+ silently sharing unit 2's.
          const fieldRole = q.fieldRole?.endsWith("_2") ? q.fieldRole.replace(/_2$/, `_${unit}`) : q.fieldRole;
          return makeReported({ ...q, id: cloneId, label: q.label.replace("(2)", `(${unit})`), fieldRole });
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

// Points ceiling is fixed regardless of model (even one with no
// independently-verified serial format still lands on a neutral mid-tier
// score, not a penalty for something nobody could have told them how to
// check) — see serialAgePoints below.
const SERIAL_AGE_MAX = 5;

// The "how old is this unit" score a plain expiry-status question can't
// give: derived from the serial number itself (see aedAgeStatus in
// aedSerialDate.js) for the three brands with a verified format. A model
// with no documented scheme gets the middle tier rather than 0 — there is
// nothing wrong with that unit, only a gap in what can be checked from the
// serial alone.
function serialAgePoints(model, serial) {
  const status = aedAgeStatus(model, serial);
  if (!status) return 3;
  if (status.ageYears < 5) return 5; // in warranty
  if (status.ageYears <= 8) return 3;
  return 1;
}

export function questionMax(question) {
  if (question.unscored) return 0;
  if (question.scoreFromSerialAge) return SERIAL_AGE_MAX;
  if (question.type === "radio" || question.type === "select") {
    return question.options.reduce((m, o) => Math.max(m, o.points || 0), 0);
  }
  if (question.type === "checkbox" || question.type === "quantity") {
    // averageAcrossSelections questions (see questionPoints) can never
    // exceed their single highest-value option regardless of how many are
    // picked, so their ceiling is that max, not the sum of every option —
    // otherwise the displayed "out of" would overstate what's actually
    // reachable. A plain checkbox/quantity question's cap isn't
    // answer-dependent for a *display* max either way — show the sum of
    // every option's points as the ceiling; the linked/fixed selection cap
    // is enforced live in the wizard UI instead.
    if (question.averageAcrossSelections) {
      return question.options.reduce((m, o) => Math.max(m, o.points || 0), 0);
    }
    return question.options.reduce((s, o) => s + (o.points || 0), 0);
  }
  return 0;
}

// `context` is optional and only ever read by a scoreFromSerialAge question
// (`{ model }`, the reporting unit's own AED brand) — every other question
// type ignores it, so existing call sites that don't pass one are unaffected.
export function questionPoints(question, answer, context) {
  if (question.unscored) return 0;
  if (question.scoreFromSerialAge) {
    const model = context?.model;
    if (!answer || !model) return 0;
    return serialAgePoints(model, answer);
  }
  if (question.type === "radio" || question.type === "select") {
    if (!answer?.value) return 0;
    const opt = question.options.find((o) => o.value === answer.value);
    return opt?.points || 0;
  }
  if (question.type === "checkbox") {
    const selections = answer?.selections || {};
    const selected = question.options.filter((o) => selections[o.value]);
    if (question.averageAcrossSelections) {
      if (selected.length === 0) return 0;
      return Math.round(selected.reduce((s, o) => s + (o.points || 0), 0) / selected.length);
    }
    return selected.reduce((s, o) => s + (o.points || 0), 0);
  }
  if (question.type === "quantity") {
    const quantities = answer?.quantities || {};
    // The AED-model question: several different models can be selected at
    // once (e.g. 2x Philips FRx + 1x Defibtech), each with its own points —
    // averaged (weighted by how many of each), not summed, so picking more
    // *distinct* models never inflates the score past what any one of them
    // is actually worth.
    if (question.averageAcrossSelections) {
      let totalUnits = 0;
      let totalPoints = 0;
      for (const o of question.options) {
        const qty = quantities[o.value] || 0;
        totalUnits += qty;
        totalPoints += qty * (o.points || 0);
      }
      return totalUnits > 0 ? Math.round(totalPoints / totalUnits) : 0;
    }
    return question.options.reduce((s, o) => s + (quantities[o.value] || 0) * (o.points || 0), 0);
  }
  return 0;
}

// Every question in a per-unit-templated section carries an explicit
// "(N)" in its label (expandUnitQuestions renumbers clones the same way),
// so grouping by that number recovers "which physical unit does this
// question belong to" without needing separate bookkeeping.
function groupSectionQuestionsByUnit(section) {
  const byUnit = new Map();
  for (const q of section.questions) {
    const unit = unitNumberFromLabel(q.label) ?? 1;
    if (!byUnit.has(unit)) byUnit.set(unit, []);
    byUnit.get(unit).push(q);
  }
  return byUnit;
}

// `schema` is optional (only needed to resolve a scoreFromSerialAge
// question's model, and only used by callers that have it handy) — every
// other question type scores the same with or without it.
export function scoreSection(section, answers, schema) {
  const visible = isSectionVisible(section, answers);

  // Physical Status / Readiness Alert / Expiry Status / Paediatric
  // Readiness are asked once per physical AED but must weigh the same
  // fixed amount (e.g. 20 points) regardless of whether a property has 1
  // AED or 5 — averaging each unit's own /max score, instead of summing
  // every unit's max into an ever-growing ceiling, is what keeps a
  // 5-AED property on the same 0-20 scale as a 1-AED one.
  if (section.averagePerUnit) {
    const byUnit = groupSectionQuestionsByUnit(section);
    const units = [...byUnit.keys()].sort((a, b) => a - b);
    if (units.length === 0) return { points: 0, max: 0, visible };
    const unitMax = byUnit.get(units[0]).reduce((s, q) => s + questionMax(q), 0);
    if (!visible) return { points: 0, max: unitMax, visible };
    const modelSequence = schema ? getAedModelSequence(schema, answers) : [];
    const unitPoints = units.map((u) =>
      byUnit.get(u).reduce((s, q) => s + questionPoints(q, answers[q.id], { model: modelSequence[u - 1] }), 0)
    );
    const points = Math.round(unitPoints.reduce((a, b) => a + b, 0) / unitPoints.length);
    return { points, max: unitMax, visible };
  }

  // Serial-number age scoring is always keyed to unit 1's own reported
  // model — see the seed data comment on scoreFromSerialAge for why this
  // section doesn't need the full per-unit averaging treatment above.
  const context = schema ? { model: getAedModelSequence(schema, answers)[0] } : undefined;
  let points = 0;
  let max = 0;
  for (const q of section.questions) {
    max += questionMax(q);
    if (visible) points += questionPoints(q, answers[q.id], context);
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
    ...scoreSection(s, answers, schema),
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

    const modelSequence = getAedModelSequence(subSchema, answers);
    for (const section of subSchema.sections) {
      if (!isSectionVisible(section, answers)) continue;
      for (const q of section.questions) {
        if (q.unscored) continue;
        const max = questionMax(q);
        if (max <= 0) continue;
        const unit = unitNumberFromLabel(q.label);
        const points = questionPoints(q, answers[q.id], { model: modelSequence[(unit || 1) - 1] });
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

// A real person's name: at least 2 letters, made up of letters/spaces/
// apostrophes/hyphens/periods only — rejects the "55", "N/A", "asdf123"
// class of junk that an empty-check alone lets straight through, without
// being so strict it rejects real names (hyphenated, apostrophes like
// O'Brien, periods in initials).
const NAME_RE = /^[A-Za-z][A-Za-z .'-]{1,49}$/;

export function isValidPersonName(value) {
  const trimmed = String(value || "").trim();
  if (!NAME_RE.test(trimmed)) return false;
  return /[A-Za-z]{2,}/.test(trimmed); // must contain an actual word, not just "A." or "- -"
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
    // Presence alone was being treated as sufficient — a stale draft,
    // tampered client, or hand-crafted POST could submit any string as
    // a.value and pass. For most radio/select questions that's just a
    // cosmetic "answer text" that fails to match anything downstream, but
    // for the AED-count question specifically an unrecognized numeric
    // string flows straight into expandUnitQuestions below, which clones
    // a per-unit question block once per unit with no upper bound.
    if (!opt) return `"${q.label}": the submitted answer is not a valid option.`;
    if (opt.allowFreeText && !a?.freeText?.trim()) {
      return `"${q.label}": enter the free-text detail for "${opt.label}".`;
    }
  } else if (q.type === "scale") {
    if (a == null) return `"${q.label}": this question is required.`;
  } else {
    if (!a || !String(a).trim()) return `"${q.label}": this question is required.`;
    if (q.type === "email" && !isValidEmail(a)) return `"${q.label}": enter a valid email address.`;
    if (q.type === "tel" && !isValidInternationalPhone(a)) return `"${q.label}": enter a valid mobile number for the selected country.`;
    if ((q.fieldRole === "first_name" || q.fieldRole === "last_name") && !isValidPersonName(a)) {
      return `"${q.label}": enter a valid name (letters only).`;
    }
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
    // Two different physical units can never share a serial number — this
    // is the single most common way a duplicate-machine mistake (typing
    // unit (1)'s serial into unit (2)'s field, or copy-pasting) slips
    // through, since every other check here only ever looks at one field in
    // isolation. Checked regardless of brand/format-verification status, on
    // every serial field, not just the ones with a known format.
    if (q.fieldRole && /^serial_number_\d+$/.test(q.fieldRole) && schema) {
      const trimmedSerial = String(a).trim().toUpperCase();
      if (trimmedSerial) {
        for (const section of schema.sections) {
          for (const other of section.questions) {
            if (other.id === q.id || !other.fieldRole || !/^serial_number_\d+$/.test(other.fieldRole)) continue;
            const otherAnswer = answers[other.id];
            if (otherAnswer && String(otherAnswer).trim().toUpperCase() === trimmedSerial) {
              return `"${q.label}": this serial number is already entered for another unit — each AED must have its own unique serial number.`;
            }
          }
        }
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
