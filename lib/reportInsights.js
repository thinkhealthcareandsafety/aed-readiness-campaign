import { questionMax, questionPoints, getAedModelSequence, getModelLabelMap } from "./genericScoring";
import { formatReportDate } from "./formatDate";

// Turns the raw answers map into the thing a respondent actually wants out
// of filling in a 30-question audit: a plain-language "here's what you told
// us, here's what it means, here's what to do about it" row per question —
// not just the aggregate category bars the report already showed. This is
// also where the commercial angle lives (an expired pad set is a line item
// someone can act on, not just a red number), so the copy below is written
// to be genuinely actionable rather than a restatement of the answer.

function stripUnitNumber(label) {
  return (label || "").replace(/\s*\(\d+\)/g, "").trim();
}

// Which physical AED a row belongs to, read off the "(N)" its own label
// carries (expandUnitQuestions numbers every per-unit clone this way, see
// lib/genericScoring.js). Null for the property-wide rows — training,
// documentation, emergency contacts — which aren't about any one machine.
function unitNumberFromLabel(label) {
  const m = /\((\d+)\)/.exec(label || "");
  return m ? parseInt(m[1], 10) : null;
}

function baseFieldRole(fieldRole) {
  return (fieldRole || "").replace(/_\d+$/, "");
}

function keyFor(question) {
  const role = baseFieldRole(question.fieldRole);
  if (role) return `role:${role}`;
  return `label:${stripUnitNumber(question.label).toLowerCase()}`;
}

function ratioStatus(points, max) {
  if (max <= 0) return "info";
  const ratio = points / max;
  if (ratio >= 0.7) return "good";
  if (ratio >= 0.3) return "warn";
  return "critical";
}

function formatDate(dateStr) {
  if (!dateStr) return null;
  return formatReportDate(dateStr);
}

// Keyed by fieldRole when the question has one (stable across form edits),
// else by its stripped, lowercased label. Per-VALUE messages win when
// present; anything without a matching value falls back to a generic
// status-band message (see genericMessage below).
const RULES = {
  "role:battery_attached": {
    byValue: {
      yes: "Battery is installed correctly and functioning properly.",
      no: "No battery detected, or it's seated incorrectly — the unit cannot deliver a shock like this. Install a compatible battery and re-check before it's needed in a real emergency.",
    },
  },
  "role:pads_connected": {
    byValue: {
      yes: "Electrode pads are connected and sealed properly.",
      no: "Pads are disconnected or the seal is broken. Exposed gel dries out fast and stops working — reseat or replace the pads now, don't wait for the next scheduled check.",
    },
  },
  "label:is there any visible damage on aed (cracks, swelling, or leakage)?": {
    byValue: {
      no: "No visible physical damage detected on the AED unit.",
      yes: "Visible damage (cracks, swelling, or leakage) was reported. Take this unit out of service and contact your AED vendor for inspection or replacement — a damaged case can mean a compromised battery or electronics inside.",
    },
  },
  "role:aed_cabinet_ok": {
    byValue: {
      yes: "AED cabinet is accessible and maintained appropriately.",
      no: "The cabinet is damaged, locked, or obstructed. An AED nobody can reach in 90 seconds is the same as not having one — clear or repair access today.",
    },
  },
  "role:readiness_indicator": {
    byValue: {
      green: "Ready indicator is green — the unit is signaling it's good to go.",
      red: "The unit is showing a fault or not-ready indicator. Don't assume it will work in an emergency — contact your service provider to diagnose it now.",
    },
  },
  "label:is there any warning beep or error message on aed?": {
    byValue: {
      no: "No warning beep or error message — a quiet, healthy unit.",
      yes: "An active warning beep or error is present. Treat this AED as out of service until the fault is identified and cleared.",
    },
  },
  "label:battery expiry status": {
    byValue: {
      gt2y: "Battery shelf life is in good standing — no action needed for a while.",
      "1to2y": "Battery is in good standing. Worth adding a replacement to next year's procurement plan so it's never a last-minute order.",
      gt6m: "Comfortable for now — add a replacement battery to next quarter's supply order.",
      within6m: "Due to expire within 6 months. Order a replacement now so it arrives well ahead of the date, not after.",
      within1m: "Expiring within a month. Order a replacement battery today — an expired battery will not reliably deliver a shock.",
      within1w: "Expiring within the week. This is urgent: order and swap the battery immediately.",
      expired: "This battery has already expired. The AED may fail exactly when it's needed — replacing it should be today's top priority, not this quarter's.",
    },
  },
  "label:electrode pads expiry status": {
    byValue: {
      gt2y: "Pad shelf life is in good standing — no action needed for a while.",
      "1to2y": "Pads are in good standing. Worth adding a replacement set to next year's procurement plan.",
      gt6m: "Comfortable for now — add a replacement pad set to next quarter's supply order.",
      within6m: "Due to expire within 6 months. Order a replacement set now so it's on the shelf before the old one lapses.",
      within1m: "Expiring within a month. Order a replacement pad set today — expired gel loses adhesion and conductivity.",
      within1w: "Expiring within the week. This is urgent: order and swap the pads immediately.",
      expired: "These pads have already expired. Expired gel won't adhere or conduct reliably — replacing them should be today's top priority.",
    },
  },
  "label:is there a paediatric pad or infant/child key for aed?": {
    byValue: {
      pads: "Paediatric readiness confirmed — this property can treat a child patient correctly.",
      key: "Paediatric readiness confirmed via child key — this property can treat a child patient correctly.",
      mode: "Paediatric readiness confirmed via a paediatric mode switch — this property can treat a child patient correctly.",
      no: "No paediatric provision on record. Adult-strength shocks are not recommended for children — consider adding paediatric pads or a child key so young guests and staff are covered too.",
    },
  },
  "role:training_recency": {
    byValue: {
      "12": "Training status is up to date.",
      "12-24": "Approaching the recommended refresher window — schedule the next AED/CPR session in the next few months rather than letting it slide past two years.",
      "24-36": "Training is overdue. Most guidelines recommend refreshing CPR/AED skills every 1-2 years — schedule a session soon.",
      over36: "No recent training on record. This is the single biggest gap on this report — a working AED is only as useful as the person who knows how to use it. Schedule certified training as soon as possible.",
    },
  },
  "role:training_headcount": {
    byValue: {
      "0-15": "A small trained group. Consider training more staff across shifts so a responder is on-site around the clock, not just during one shift.",
      "15-30": "A reasonable trained group — consider extending training to cover every shift, including nights and weekends.",
      "30-50": "Good training reach across your team.",
      "50-100": "Good number of trained responders available.",
      "100+": "Strong training reach across your team.",
    },
  },
  "label:do you use any software to track aed maintenance and inspections?": {
    byValue: {
      plustrack: "A maintenance tracking system is in place — good practice.",
      aedsmartx: "A maintenance tracking system is in place — good practice.",
      manual: "A manual log works, but it's the most common way an expiry date gets missed. A digital tracking tool would flag battery/pad expiries automatically.",
      none: "No tracking system in place. This is exactly how expired batteries and pads go unnoticed until an emergency — consider adopting a tracking tool or at minimum a shared calendar reminder.",
    },
  },
  "label:are you trained in cpr?": {
    byValue: {
      yes: "CPR training completed.",
      no: "No CPR training on record for this respondent — this also means the Good Samaritan Warrior certificate isn't unlocked yet.",
    },
  },
  "label:are you trained to operate an aed?": {
    byValue: {
      yes: "AED operation training completed.",
      no: "No AED operation training on record for this respondent — this also means the Good Samaritan Warrior certificate isn't unlocked yet.",
    },
  },
  "label:are you confident of using aed and performing cpr during an emergency?": {
    byValue: {
      yes: "Reports feeling confident responding with an AED and CPR.",
      no: "Reports low confidence responding in an emergency — pairing this respondent with a hands-on refresher (not just a repeat lecture) usually closes this faster than another certificate does.",
    },
  },
  "label:what is the minimum chest compression required for an adult?": {
    byValue: {
      "5cm": "Correct — at least 5 cm is the recommended minimum adult compression depth.",
      "3-4cm": "Incorrect. The recommended minimum adult compression depth is at least 5 cm (about 2 inches) — under-compressing reduces blood flow during CPR. Worth a quick refresher.",
      lt3cm: "Incorrect. The recommended minimum adult compression depth is at least 5 cm (about 2 inches), notably deeper than what was selected — worth a quick refresher.",
    },
  },
  "label:which age range is considered a child in cpr?": {
    byValue: {
      "1-8": "Correct — 1-8 years is the standard paediatric CPR age range.",
      "18+": "Incorrect. For CPR purposes, a child is typically defined as 1-8 years old, not 18+ — this is worth reviewing since it changes which technique and pad set to use.",
      lt1: "Incorrect. For CPR purposes, a child is typically defined as 1-8 years old — under 1 year falls under infant CPR guidance instead, which uses a different technique.",
    },
  },
};

const CHECKBOX_RULES = {
  "label:which emergency accessories do you have with your aed?": {
    allSelected: "Emergency accessories are well maintained.",
    missingPrefix: "Consider adding to the kit: ",
  },
  "label:which emergency contact number is mentioned on your aed?": {
    allSelected: "Emergency contact numbers are fully posted on the unit.",
    missingPrefix: "Consider posting on the unit: ",
  },
  "label:which documentation do you maintain periodically?": {
    allSelected: "Documentation records are maintained properly.",
    missingPrefix: "Consider starting to keep: ",
  },
};

function genericMessage(status) {
  if (status === "good") return "This is in good standing.";
  if (status === "warn") return "Worth a closer look.";
  if (status === "critical") return "Needs attention.";
  return null;
}

// One row per answered, gradeable (radio/select/checkbox) question, in
// section order. Identity fields (name/email/hotel/etc.), raw expiry dates
// (folded into their derived status row instead), and unscored/not-reported
// template questions are intentionally left out — see the call sites in the
// report page for how those are shown instead.
export function buildQuestionRows(schema, answers) {
  const rows = [];
  const SKIP_ROLES = new Set(["hotel", "first_name", "last_name", "email", "phone", "has_aed_gate"]);
  // With only one AED on-site, "(1)" in every label is dead weight — there's
  // nothing to disambiguate, so this keeps stripping it for that common
  // case. With 2+, dropping it is exactly the bug reported live: every
  // unit's "Is the battery installed correctly?" rendered as an identical
  // row with no way to tell which physical AED a critical finding was
  // actually about.
  const unitCount = getAedModelSequence(schema, answers).length;

  for (const section of schema.sections) {
    if (section.unscored) continue; // identity/gate sections — shown elsewhere, not as graded rows
    for (const q of section.questions) {
      if (q.type === "date") continue; // folded into its derived status row below
      if (q.type === "scale") continue; // self-rated confidence, shown separately
      const role = baseFieldRole(q.fieldRole);
      if (SKIP_ROLES.has(role)) continue;
      if (/^serial_number$/.test(role)) continue; // shown in the inventory block instead
      const answer = answers[q.id];
      const hasAnswer =
        q.type === "checkbox" ? Object.values(answer?.selections || {}).some(Boolean) :
        q.type === "quantity" ? Object.values(answer?.quantities || {}).some((n) => n > 0) :
        Boolean(answer?.value);
      if (!hasAnswer) continue;

      const max = questionMax(q);
      const points = questionPoints(q, answer);
      // The AED-model quantity question scores every possible model equally
      // (1 point each) purely so *some* selection is required — its point
      // total was never meant to represent "how many models you should
      // have" the way every other question's max represents a real target,
      // so grading it on the same points/max ratio would flag a perfectly
      // normal 1-2-model fleet as a critical gap. Shown as plain inventory
      // info instead.
      const isAedCountQuestion = q.type === "select" && stripUnitNumber(q.label).toLowerCase() === "select the number of aeds installed";
      const status = q.unscored || q.type === "quantity" || isAedCountQuestion ? "info" : ratioStatus(points, max);
      const key = keyFor(q);

      let answerText;
      let recommendation;

      if (q.type === "checkbox") {
        const selected = q.options.filter((o) => answer.selections[o.value]);
        const unselected = q.options.filter((o) => !answer.selections[o.value]);
        answerText = selected.map((o) => o.label).join(", ") || "None selected";
        const rule = CHECKBOX_RULES[key];
        if (rule) {
          recommendation = unselected.length === 0 ? rule.allSelected : `${rule.missingPrefix}${unselected.map((o) => o.label).join(", ")}.`;
        } else {
          recommendation = unselected.length === 0 ? genericMessage("good") : genericMessage(status);
        }
      } else if (q.type === "quantity") {
        // The AED model(s) question — not gradeable (every listed model is a
        // legitimate, supported unit), just an inventory line with a plain
        // reassurance, mirroring the reference report's "your choice of AED
        // is perfect" tone.
        const picked = q.options.filter((o) => (answer.quantities || {})[o.value] > 0);
        answerText = picked.map((o) => `${o.label}${answer.quantities[o.value] > 1 ? ` ×${answer.quantities[o.value]}` : ""}`).join(", ");
        recommendation = "Your registered AED model(s) are well-supported, commonly serviced units.";
      } else if (isAedCountQuestion) {
        answerText = answer.value === "1" ? "1" : `${answer.value}`;
        recommendation =
          answer.value === "1"
            ? "A single AED is functional — if the property spans multiple floors or detached buildings, a second unit closes the response-time gap."
            : "Multiple AEDs on-site is a healthy sign of layered coverage.";
      } else {
        const opt = q.options?.find((o) => o.value === answer.value);
        answerText = opt ? [opt.label, opt.sub].filter(Boolean).join(" — ") : answer.value;
        if (opt?.allowFreeText && answer.freeText) answerText += ` (${answer.freeText})`;

        // Fold the paired expiry date into the status row's own answer text
        // ("Between 1-2 years (5 Jan 2028)") rather than showing it as its
        // own separate, less meaningful row.
        if (q.derivedFromDateQuestionId != null) {
          const dateStr = answers[q.derivedFromDateQuestionId];
          const formatted = formatDate(dateStr);
          if (formatted) answerText += ` (${formatted})`;
        }

        const rule = RULES[key];
        recommendation = rule?.byValue?.[answer.value] || genericMessage(status);
      }

      if (!recommendation) continue; // nothing useful to say (e.g. an unscored info field with no rule)

      rows.push({
        id: q.id,
        section: section.title,
        letter: section.letter,
        label: unitCount > 1 ? q.label : stripUnitNumber(q.label),
        unit: unitNumberFromLabel(q.label),
        answerText,
        status,
        recommendation,
      });
    }
  }
  return rows;
}

// One entry per physical AED on site — the model and serial the responder
// registered for that unit — so the report can label a findings tab "AED 1
// · Philips FRx · SN B17C-00516" rather than a bare number. Mirrors the
// per-unit banner the wizard itself shows while answering (see
// serialByUnit in components/AuditWizard.jsx): with 2+ units, especially
// 2+ of the *same* model, the serial is the only thing that identifies
// which machine on the wall a finding is actually about.
export function buildUnitSummaries(schema, answers) {
  const modelLabels = getModelLabelMap(schema);
  const serialByRole = new Map();
  for (const section of schema.sections) {
    for (const q of section.questions) {
      if (q.fieldRole && /^serial_number_\d+$/.test(q.fieldRole)) {
        const value = answers[q.id];
        if (value) serialByRole.set(q.fieldRole, String(value).trim());
      }
    }
  }
  return getAedModelSequence(schema, answers).map((model, i) => ({
    unit: i + 1,
    modelLabel: modelLabels[model] || null,
    serial: serialByRole.get(`serial_number_${i + 1}`) || null,
  }));
}

// A short, auto-written closing paragraph in the same spirit as the
// reference PDF's "Final Observation" — graded off the same overall
// percentage the score hero already shows, not a separate judgment call.
export function finalObservation(pct, criticalCount) {
  if (pct >= 85 && criticalCount === 0) {
    return "Strong AED readiness observed. This property is close to best-practice across the board — keep the same inspection and training cadence going forward.";
  }
  if (pct >= 65) {
    return "Moderate AED readiness observed. The core equipment is largely in place, but the flagged items below are worth acting on soon rather than at the next scheduled review.";
  }
  return "This property has real readiness gaps that need attention. The flagged items below — particularly anything marked as needing attention — should be treated as this week's priority, not a future to-do.";
}
