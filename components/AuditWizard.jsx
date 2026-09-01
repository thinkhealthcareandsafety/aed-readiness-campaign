"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { QBlock, RadioGroup, CheckboxList, IconRadioGrid, IconCheckboxGrid, IconQuantityGrid, TextInput, Select, TabSelect, LinearScale, qblockLabelId } from "@/components/fields";
import { OptionImage, isPhotoUrl } from "@/components/OptionImage";
import { FieldReferencePhoto, ImageLightbox, referenceKindFor, unitNumberFromLabel, photoForModel } from "@/components/ReferenceGuide";
import AutoInspection from "@/components/AutoInspection";
import { HotelSelect } from "@/components/HotelSelect";
import { logoForHotel } from "@/lib/hotelBrands";
import Landing from "@/components/Landing";
import LiveScore from "@/components/LiveScore";
import PrizeWheel from "@/components/PrizeWheel";
import { CHECKLIST_ITEMS, fieldRoleFor } from "@/lib/inspectionChecklist";
import { sortHotelOptionsByCity } from "@/lib/hotelCities";
import { isSectionVisible, maxSelectionsFor, validateSection, questionMax, extractIdentity, resolveDerivedAnswers, expandUnitQuestions, reconcileLinkedSelections, getSelectedAedModels, getAedModelSequence, getModelLabelMap, scoreSubmission } from "@/lib/genericScoring";
import { aedAgeStatus, isValidAedSerialFormat, aedSerialFormatHint, aedSerialExample } from "@/lib/aedSerialDate";
import { COUNTRY_CODES, DEFAULT_COUNTRY_ISO, countryByIso, composePhoneValue, parsePhoneValueLenient, sanitizeLocalDigits } from "@/lib/phoneCountries";

const REVIEW_STEP = { id: "__review", letter: "✓", title: "Review & Submit", note: "Check your answers, then send the audit.", questions: [] };

// The battery_attached/pads_connected questions were seeded with one fixed
// pair of real Philips FRx photos (see lib/seedFormData.js) — correct for
// an FRx unit, actively wrong for any other reported model. Maps each
// "attached" reference-photo kind to its "not attached" sibling in
// MODEL_PHOTOS (ReferenceGuide.jsx) — used for a non-FRx unit's "No"
// answer once a model has its own real photo for that state (currently
// zollPlus; see the resolvedOptionImage below).
const NOT_ATTACHED_KIND = { batteryAttached: "batteryNotAttached", padsAttached: "padsNotAttached", readyIndicator: "notReadyIndicator" };
// Brand-agnostic line icons (the seed's own pre-photo defaults) — the
// final fallback when a model has neither a real "not attached" photo nor
// the seeded FRx one applies. Showing the FRx-specific "not attached"
// photo mislabeled as e.g. a Defibtech unit would be worse than a generic
// icon, not better.
const GENERIC_NOT_ATTACHED_ICON = { batteryAttached: "/icons/battery-bad.svg", padsAttached: "/icons/pads-unsealed.svg" };

// Only ever inserted right after the AED Status (registration) section —
// i.e. only when the responder has already confirmed they have an AED and
// registered it — see modeChoiceInsertIndex below, so auto-scan is never
// offered when there's nothing registered yet to point a camera at.
const MODE_CHOICE_STEP = {
  id: "__mode_choice",
  letter: "✦",
  title: "How would you like to complete this?",
  note: "Photograph your AED and let AI read the details, or answer each question yourself.",
  questions: [],
};

// A plain fetch() never times out on its own — on flaky hotel wifi a
// request can stall indefinitely with no error and no response, which
// previously left submit()/the early email check spinning ("Submitting...",
// "Checking...") forever with no way to recover short of reloading the
// whole 14-step form and losing the in-progress draft. AbortController
// turns a hang into an actual rejected promise the existing catch blocks
// already handle.
function fetchWithTimeout(url, options, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

// Same "_1" exception, "_N" convention as fieldRoleFor in
// lib/inspectionChecklist.js, kept local rather than imported from there
// since that module's fieldRoleFor is scoped to auto-inspection's own
// concept ids and deliberately excludes serial_number (see the comment at
// the top of lib/inspectionChecklist.js).
function serialFieldRoleFor(unit) {
  return unit === 1 ? "serial_number_1" : `serial_number_${unit}`;
}

function findQuestionByFieldRole(schema, role) {
  for (const s of schema.sections) {
    for (const q of s.questions) {
      if (q.fieldRole === role) return q;
    }
  }
  return null;
}

// A refresh mid-audit (accidental reload, a flaky connection, closing the
// tab to come back to a long form later) used to wipe every answer back to
// step 1, since progress only ever lived in React state. Mirroring it into
// localStorage — restored once on mount, cleared on a successful submit —
// means a reload resumes exactly where the responder left off instead.
const DRAFT_KEY = "aed-audit-draft-v1";
const DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // older than this, treat it as abandoned rather than resuming it

function loadDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const draft = JSON.parse(raw);
    if (!draft?.savedAt || Date.now() - new Date(draft.savedAt).getTime() > DRAFT_MAX_AGE_MS) return null;
    return draft;
  } catch {
    return null;
  }
}

export default function AuditWizard({ schema, detectedCity }) {
  const router = useRouter();
  // Starts at the server-detected (IP-geolocated, or "Pune" on localhost)
  // city; the picker lets the responder override it if they're auditing a
  // property outside their own city.
  const [selectedCity, setSelectedCity] = useState(detectedCity || null);
  const [answers, setAnswersRaw] = useState({});
  // Every update is re-resolved so date-derived questions (e.g. expiry tier
  // from an expiry date) always reflect the latest date, no matter which
  // handler triggered the change. The schema is also re-expanded against the
  // latest answers first, so extra AED-unit blocks (when 3+ units are
  // reported) get their own date-derived fields resolved too.
  function setAnswers(updater) {
    setAnswersRaw((a) => {
      const next = typeof updater === "function" ? updater(a) : updater;
      const reconciled = reconcileLinkedSelections(schema, next);
      return resolveDerivedAnswers(expandUnitQuestions(schema, reconciled), reconciled);
    });
  }
  const [stepIndex, setStepIndex] = useState(0);
  const [error, setError] = useState(null);
  const [checkingEmail, setCheckingEmail] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // The prize the server already decided at submission time (see
  // POST /api/submissions) — set once, on success, and never recomputed
  // client-side. Its presence is what triggers the <PrizeWheel> overlay.
  const [wonPrize, setWonPrize] = useState(null);
  const [submittedId, setSubmittedId] = useState(null);
  const [submitError, setSubmitError] = useState(null);
  const [draftRestored, setDraftRestored] = useState(false);
  const [showResumeToast, setShowResumeToast] = useState(false);
  const [autoScanActive, setAutoScanActive] = useState(false);
  // Question id -> the AI verdict that filled it, so the field can show a
  // small "auto-detected" badge without ever hiding the normal editable
  // input underneath it (a bad read must always stay correctable).
  const [aiFilled, setAiFilled] = useState({});
  const headingRef = useRef(null);

  // Runs once on mount, client-side only (localStorage doesn't exist during
  // server rendering) — restores a prior in-progress draft, if any. This
  // can't be a lazy useState initializer instead (the usual way to avoid an
  // effect-plus-setState): that runs during render, including the server
  // render, where localStorage isn't defined, and reading it only on the
  // client there would make the client's first render disagree with the
  // already-sent server HTML — a real hydration mismatch. Starting at the
  // server-safe default and correcting it here, after mount, avoids that.
  useEffect(() => {
    const draft = loadDraft();
    if (draft) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- see comment above: intentional one-time client-only hydration, not a prop/state sync
      if (draft.answers) setAnswersRaw(draft.answers);
      if (typeof draft.stepIndex === "number") setStepIndex(draft.stepIndex);
      // A restored draft otherwise looks identical to a fresh form with a
      // couple of fields pre-filled by coincidence — nothing tells the
      // responder their earlier progress actually came back, so a reload
      // mid-form can read as data loss even though it isn't.
      if (draft.answers && Object.keys(draft.answers).length > 0) setShowResumeToast(true);
    }
    setDraftRestored(true);
  }, []);

  useEffect(() => {
    if (!showResumeToast) return;
    const t = setTimeout(() => setShowResumeToast(false), 6000);
    return () => clearTimeout(t);
  }, [showResumeToast]);

  // Mirrors current progress into localStorage on every change, so a reload
  // resumes here instead of at step 1. Gated on draftRestored so the initial
  // blank state (before the restore effect above has run) can't race ahead
  // and overwrite a real draft with nothing.
  useEffect(() => {
    if (!draftRestored) return;
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ answers, stepIndex, savedAt: new Date().toISOString() }));
    } catch {
      // localStorage can throw (private browsing, quota) — losing draft
      // persistence isn't worth surfacing an error over.
    }
  }, [answers, stepIndex, draftRestored]);

  // Without this, the browser keeps whatever scroll position you were at —
  // on mobile that's usually the bottom of the previous (longer) step, right
  // by the Next button, leaving the new step's questions off-screen above.
  // Moving focus to the new heading alongside the scroll matters just as
  // much for anyone not looking at the screen: without it, a step change is
  // silent to a screen reader and keyboard focus is left stranded on the
  // (now relocated) Next button from the previous step.
  useEffect(() => {
    window.scrollTo(0, 0);
    headingRef.current?.focus({ preventScroll: true });
  }, [stepIndex]);

  const expandedSchema = useMemo(() => expandUnitQuestions(schema, answers), [schema, answers]);
  // Cheap pure function over the schema/answers already in memory — safe to
  // recompute on every keystroke/click for the live-score badge, the same
  // way the report page computes it once at the end.
  const scored = useMemo(() => scoreSubmission(expandedSchema, answers), [expandedSchema, answers]);
  const selectedAedModels = useMemo(() => getSelectedAedModels(schema, answers), [schema, answers]);
  const aedModelSequence = useMemo(() => getAedModelSequence(schema, answers), [schema, answers]);
  // Each unit's own serial number, already typed in during device
  // registration (AED Status) — pulled forward so the per-unit banner in
  // every later section (and the AI-scan view) can show "AED (2) —
  // ZOLL AED Plus — SN X20B123456" instead of just a bare unit number, so
  // it's unambiguous which physical machine's questions you're answering
  // even with 2+ units of the same or different models.
  const serialByUnit = useMemo(
    () =>
      aedModelSequence.map((_, i) => {
        const q = findQuestionByFieldRole(expandedSchema, serialFieldRoleFor(i + 1));
        return q ? answers[q.id] || null : null;
      }),
    [expandedSchema, answers, aedModelSequence]
  );
  // The training-headcount question shows a combined recency+headcount
  // status message (see trainingStatusMessage) once both questions in this
  // section are answered — pulled up here rather than looked up inside
  // QuestionBlock since that component only ever sees its own question, not
  // the schema needed to find a sibling one by fieldRole.
  const trainingRecencyValue = useMemo(() => {
    const q = findQuestionByFieldRole(expandedSchema, "training_recency");
    return q ? answers[q.id]?.value || null : null;
  }, [expandedSchema, answers]);
  const modelLabelByValue = useMemo(() => getModelLabelMap(schema), [schema]);
  const visibleSections = useMemo(
    () => expandedSchema.sections.filter((s) => isSectionVisible(s, answers)),
    [expandedSchema, answers]
  );
  // The mode-choice screen only makes sense once the responder has actually
  // registered which AEDs they have (count, model, serial — the "AED
  // Status" section, always the first one gated on has_aed_gate), so it's
  // inserted right *after* that section instead of before it: register the
  // devices first, then decide how to inspect them. Never shown at all when
  // the responder said no to having an AED in the first place.
  const modeChoiceInsertIndex = useMemo(() => {
    const firstGated = visibleSections.findIndex((s) => s.visibleIfValue != null);
    return firstGated === -1 ? -1 : firstGated + 1;
  }, [visibleSections]);
  const steps = useMemo(() => {
    if (modeChoiceInsertIndex === -1) return [...visibleSections, REVIEW_STEP];
    return [
      ...visibleSections.slice(0, modeChoiceInsertIndex),
      MODE_CHOICE_STEP,
      ...visibleSections.slice(modeChoiceInsertIndex),
      REVIEW_STEP,
    ];
  }, [visibleSections, modeChoiceInsertIndex]);
  const step = steps[Math.min(stepIndex, steps.length - 1)];
  const isLast = stepIndex === steps.length - 1;
  const isReview = step.id === "__review";
  const isModeChoice = step.id === "__mode_choice";

  function setAnswer(questionId, value) {
    setAnswers((a) => ({ ...a, [questionId]: value }));
  }

  // The deselect-on-reclick decision (letting a respondent back out of a
  // single-choice answer instead of being stuck with the first thing they
  // tapped) is made by the field component itself — RadioGroup/IconRadioGrid
  // pass "" explicitly when the click landed on the already-selected
  // option, the real value otherwise. Redoing that comparison here too,
  // against freshly-updated state inside a functional setState updater,
  // was the actual bug: a genuine new selection fires both onClick and
  // onChange, and the second call would see the first call's own update
  // and immediately undo it.
  function setRadioAnswer(question, value) {
    setAnswers((a) => ({ ...a, [question.id]: { value, freeText: a[question.id]?.freeText || "" } }));
  }

  function setFreeText(question, optionValue, text) {
    setAnswers((a) => {
      const cur = a[question.id] || {};
      if (question.type === "checkbox" || question.type === "quantity") {
        return { ...a, [question.id]: { ...cur, freeText: { ...(cur.freeText || {}), [optionValue]: text } } };
      }
      return { ...a, [question.id]: { ...cur, freeText: text } };
    });
  }

  function setCheckboxAnswer(question, optionValue, checked) {
    setAnswers((a) => {
      const cur = a[question.id] || { selections: {}, freeText: {} };
      const limit = maxSelectionsFor(question, a);
      const selections = { ...cur.selections };
      if (!checked) {
        selections[optionValue] = false;
      } else if (Number.isFinite(limit) && limit === 1) {
        Object.keys(selections).forEach((k) => (selections[k] = false));
        selections[optionValue] = true;
      } else {
        const trueCount = Object.values(selections).filter(Boolean).length;
        if (Number.isFinite(limit) && trueCount >= limit) return a;
        selections[optionValue] = true;
      }
      return { ...a, [question.id]: { ...cur, selections } };
    });
  }

  function setQuantityAnswer(question, optionValue, newQty) {
    setAnswers((a) => {
      const cur = a[question.id] || { quantities: {}, freeText: {} };
      const limit = maxSelectionsFor(question, a);
      const quantities = { ...cur.quantities };
      const currentForKey = quantities[optionValue] || 0;
      const currentTotal = Object.values(quantities).reduce((s, n) => s + (n || 0), 0);
      const delta = newQty - currentForKey;
      if (newQty < 0) return a;
      if (delta > 0 && Number.isFinite(limit) && currentTotal + delta > limit) return a;
      quantities[optionValue] = newQty;
      return { ...a, [question.id]: { ...cur, quantities } };
    });
  }

  // Maps each auto-inspection checklist result onto the question tagged
  // with the matching fieldRole (see lib/inspectionChecklist.js and the
  // fieldRole tags in lib/seedFormData.js — the checklist item id and the
  // fieldRole are the same string by convention), through the exact same
  // setAnswer/setRadioAnswer the manual inputs use. That keeps derived
  // fields (expiry tier), validation, and scoring working unmodified — the
  // wizard can't tell an AI-filled answer from a typed one downstream.
  function handleAutoInspectionComplete(results) {
    const aiInfoUpdates = {};
    // One (concept, unit) pair per reported physical AED — mirrors
    // buildTasks() in components/AutoInspection.jsx exactly, so every
    // result key it produced (fieldRoleFor(item.id, unit)) is looked up
    // here the same way, whether there's 1 unit or 5.
    for (let unit = 1; unit <= Math.max(1, aedModelSequence.length); unit++) {
      for (const item of CHECKLIST_ITEMS) {
        const fieldRole = fieldRoleFor(item.id, unit);
        const result = results[fieldRole];
        if (!result || (result.status !== "pass" && result.status !== "fail")) continue;
        const q = findQuestionByFieldRole(expandedSchema, fieldRole);
        if (!q) continue;

        if (item.id === "battery_expiry_date" || item.id === "pads_expiry_date") {
          if (!result.expiry_date) continue;
          // A month-only read ("YYYY-MM") needs a day for the <input type=date>
          // — default to the 1st; it's a starting point the responder reviews
          // and can correct, not a claim about the real expiry day.
          setAnswer(q.id, result.expiry_date.length === 7 ? `${result.expiry_date}-01` : result.expiry_date);
        } else if (item.id === "battery_attached" || item.id === "pads_connected") {
          setRadioAnswer(q, result.passed ? "yes" : "no");
        } else {
          continue;
        }
        aiInfoUpdates[q.id] = result;
      }
    }
    setAiFilled((prev) => ({ ...prev, ...aiInfoUpdates }));
    setAutoScanActive(false);
    setStepIndex((i) => Math.min(i + 1, steps.length - 1));
  }

  async function goNext() {
    if (!isReview) {
      const err = validateSection(step, answers, expandedSchema);
      if (err) {
        setError(err.message);
        scrollToQuestion(err.questionId);
        return;
      }
    }

    // Early, courtesy-only duplicate-email check right as they leave step
    // 1 — finding out now beats finding out after 13 more steps. This is
    // NOT the real enforcement: submit() below re-checks server-side
    // regardless, since a client could skip this call entirely.
    if (stepIndex === 0) {
      const emailQuestion = findQuestionByFieldRole(expandedSchema, "email");
      const email = emailQuestion ? answers[emailQuestion.id] : null;
      if (email) {
        setCheckingEmail(true);
        try {
          const res = await fetchWithTimeout("/api/submissions/check-email", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email }),
          });
          const data = await res.json().catch(() => ({}));
          if (data?.taken) {
            setCheckingEmail(false);
            setError("This email has already completed an audit.");
            scrollToQuestion(emailQuestion.id);
            return;
          }
        } catch {
          // A network hiccup here shouldn't block progress — submit() runs
          // the authoritative check again regardless.
        }
        setCheckingEmail(false);
      }
    }

    setError(null);
    if (isLast) return;
    setStepIndex((i) => Math.min(i + 1, steps.length - 1));
  }

  // Long steps (some run to 6-7 questions) made the single footer error
  // message easy to lose track of — this brings the actual offending field
  // into view and gives it a brief highlight so there's no hunting for it.
  function scrollToQuestion(questionId) {
    if (!questionId) return;
    requestAnimationFrame(() => {
      const el = document.getElementById(`q-field-${questionId}`);
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.remove("q-flash");
      // Force a reflow so re-adding the class restarts the animation even
      // if the same field is flashed twice in a row.
      void el.offsetWidth;
      el.classList.add("q-flash");
      const input = el.querySelector("input, select, textarea, .hotel-select-trigger");
      input?.focus?.({ preventScroll: true });
    });
  }
  function goBack() {
    setError(null);
    setStepIndex((i) => Math.max(i - 1, 0));
  }

  // Step dots for already-completed steps are clickable — same permissive
  // "no re-validation" model goBack already uses, just a shortcut past
  // repeated Back clicks instead of a new navigation rule.
  function jumpToStep(i) {
    if (i >= stepIndex) return;
    setError(null);
    setAutoScanActive(false);
    setStepIndex(i);
  }

  async function submit() {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetchWithTimeout(
        "/api/submissions",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ answers }),
        },
        30000 // the actual submission does real work server-side (scoring, prize pick, a DB write) — longer budget than the courtesy email check above
      );
      // Read the body on failure too — a 409 duplicate-email response has a
      // specific, actionable message ("This email has already completed an
      // audit.") that a bare "Submission failed" would otherwise swallow.
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Submission failed");
      try {
        localStorage.removeItem(DRAFT_KEY);
      } catch {
        // best-effort cleanup only
      }
      // Navigation to /report/id is deferred until the prize reveal is
      // dismissed (see PrizeWheel's onDone below) rather than happening
      // immediately — data.prize is whatever the server already decided,
      // never computed or guessed here.
      setSubmittedId(data.id);
      setWonPrize(data.prize);
      setSubmitting(false);
    } catch (err) {
      // fetchWithTimeout's AbortController rejects with a DOMException named
      // "AbortError", whose own .message ("signal is aborted without
      // reason") means nothing to a hotel staffer — swapped for copy that
      // actually tells them what to do about it. The 14 steps of answers
      // are still sitting safely in the draft (see loadDraft/localStorage
      // above), so "try again" is a real, low-cost recovery, not a threat
      // of lost work.
      const timedOut = err instanceof Error && err.name === "AbortError";
      setSubmitError(
        timedOut
          ? "That took too long to send — check your connection and try again. Your answers are still saved."
          : err instanceof Error
            ? err.message
            : "Something went wrong sending your audit. Please try again."
      );
      setSubmitting(false);
    }
  }

  const identity = extractIdentity(schema, answers);
  // Once the responder has picked their hotel, brand it back at them for
  // the rest of the audit — a small "you're doing this for [hotel]" touch
  // that makes a 14-step form feel tailored rather than generic. Silently
  // absent for "Other"/unmatched entries (no logo asset exists), same
  // graceful-fallback rule the picker itself already follows.
  const hotelBrand = identity.hotel ? logoForHotel(identity.hotel) : null;

  return (
    <>
      {/* Marketing/landing content only belongs on the very first step —
          once the responder starts answering, it should never resurface
          above every subsequent step of a 14-step form. */}
      {stepIndex === 0 && <Landing />}
      <div className="wizard-page" id="audit">
        <div className="wizard-topbar">
          <div className="brandrow">
            <div className="brand">
              {/* eslint-disable-next-line @next/next/no-img-element -- static brand asset, no next/image needed */}
              <img src="/brand/thinkhealth-logo.png" alt="Think Health" className="brand-logo" />
              <span>
                AED Readiness Campaign
                <small>Think Health &middot; PREPARED Score</small>
              </span>
            </div>
            <div className="topbar-meta">
              {!isModeChoice && <LiveScore points={scored.total.points} max={scored.total.max} />}
              <div className="step-label">
                Step {stepIndex + 1} / {steps.length}
              </div>
            </div>
          </div>
          {hotelBrand && (
            <div className="hotel-card">
              {/* eslint-disable-next-line @next/next/no-img-element -- static bundled brand mark, no next/image needed */}
              <img src={hotelBrand.logo} alt="" className="hotel-card-logo" />
              <div className="hotel-card-text">
                <span className="hotel-card-eyebrow">Auditing for</span>
                <span className="hotel-card-name">{identity.hotel}</span>
              </div>
            </div>
          )}
          <div className="step-dots">
            {steps.map((s, i) => (
              <button
                key={s.id}
                type="button"
                className={`dot-item${i < stepIndex ? " done" : ""}${i === stepIndex ? " current" : ""}`}
                onClick={() => jumpToStep(i)}
                disabled={i >= stepIndex}
                aria-current={i === stepIndex ? "step" : undefined}
                aria-label={`${i < stepIndex ? "Go back to" : i === stepIndex ? "Current step:" : "Step"} ${i + 1}, ${s.title}`}
              />
            ))}
          </div>
        </div>

        <div className="wizard-main">
          {showResumeToast && (
            <div className="callout structure resume-toast">
              <span>Welcome back — resuming right where you left off.</span>
              <button
                type="button"
                className="resume-toast-close"
                onClick={() => setShowResumeToast(false)}
                aria-label="Dismiss"
              >
                &times;
              </button>
            </div>
          )}
          <div className="wizard-card" key={step.id} style={{ animation: "stepFade .28s ease both" }}>
            <div className="section-eyebrow">
              <span className="letter">{step.letter}</span>
              {/* tabIndex=-1 + programmatic focus on every step change (see the
                stepIndex effect above) — not reachable via Tab, only ever
                focused by that effect, so a screen reader announces the new
                step instead of leaving focus stranded on the previous
                step's (now relocated) Next button. */}
              <h2 ref={headingRef} className="section-title" tabIndex={-1} style={{ marginBottom: 0 }}>
                {step.title}
              </h2>
            </div>
            {isReview ? (
              <div className="callout ready">
                Thanks, {identity.firstName || "there"} — everything&rsquo;s filled in for{" "}
                <b>{identity.hotel || "your hotel"}</b>. Press <b>Submit audit</b> below to save this response and see
                your PREPARED score and detailed AED report.
              </div>
            ) : isModeChoice ? (
              autoScanActive ? (
                <AutoInspection
                  unitCount={aedModelSequence.length}
                  modelSequence={aedModelSequence}
                  modelLabelMap={modelLabelByValue}
                  serialByUnit={serialByUnit}
                  onComplete={handleAutoInspectionComplete}
                  onCancel={() => setAutoScanActive(false)}
                />
              ) : (
                <div className="mode-choice-grid">
                  <button
                    type="button"
                    className="mode-choice-card"
                    onClick={() => setStepIndex((i) => Math.min(i + 1, steps.length - 1))}
                  >
                    <span className="tag">Manual</span>
                    <h3>Continue manually</h3>
                    <p>Answer each question yourself, same as before — takes about 5 minutes.</p>
                  </button>
                  <button type="button" className="mode-choice-card" onClick={() => setAutoScanActive(true)}>
                    <span className="tag">AI scan</span>
                    <h3>Scan automatically</h3>
                    <p>
                      Photograph your AED&rsquo;s labels and status light — AI reads the serial number, expiry dates,
                      and condition for you.
                    </p>
                  </button>
                </div>
              )
            ) : (
              // A section like Expiry Status asks about "Battery (1)", "Pads
              // (1)", "Battery (2)", "Pads (2)"... back to back — with two
              // different brands reported, nothing on screen said which
              // physical unit "(2)" actually was without scrolling down to
              // spot the small reference-photo thumbnail. lastUnitRef tracks
              // the unit number as the loop walks through, purely to detect
              // "this question starts a new unit" — a plain local, not React
              // state, since it only needs to last for this one render pass.
              (() => {
                let lastUnit = null;
                return (
                  <div className="wizard-questions-grid">
                    {step.questions.map((q) => {
                      const unit = unitNumberFromLabel(q.label);
                      const isNewUnit = unit != null && unit !== lastUnit;
                      if (unit != null) lastUnit = unit;
                      const unitModel = isNewUnit ? aedModelSequence[unit - 1] : null;
                      const unitModelLabel = unitModel ? modelLabelByValue[unitModel] : null;
                      const unitSerial = isNewUnit ? serialByUnit[unit - 1] : null;
                      return (
                        <div key={q.id} id={`q-field-${q.id}`} className={`q-wrapper${q.fieldRole ? ` field-role-${q.fieldRole}` : ""}`}>
                          {isNewUnit && (
                            <div className="unit-banner">
                              <span className="unit-banner-id">
                                AED ({unit}){unitModelLabel ? ` — ${unitModelLabel}` : ""}
                              </span>
                              {unitSerial && <span className="unit-banner-serial">SN {unitSerial}</span>}
                            </div>
                          )}
                          <QuestionBlock
                            question={q}
                            aiInfo={aiFilled[q.id]}
                            answers={answers}
                            setAnswer={setAnswer}
                            setRadioAnswer={setRadioAnswer}
                            setCheckboxAnswer={setCheckboxAnswer}
                            selectedCity={selectedCity}
                            onCityChange={setSelectedCity}
                            setQuantityAnswer={setQuantityAnswer}
                            setFreeText={setFreeText}
                            selectedAedModels={selectedAedModels}
                            aedModelSequence={aedModelSequence}
                            trainingRecencyValue={trainingRecencyValue}
                          />
                        </div>
                      );
                    })}
                  </div>
                );
              })()
            )}
          </div>
        </div>

        {!autoScanActive && (
          <div className="wizard-footer">
            <div className="inner">
              {/* Used to sit crammed into the same row as Back/Next, competing
               with them for width — a longer message (there are several
               now: duplicate-serial, phone-country, serial-format-hint)
               just got ellipsis-truncated mid-sentence with no way to read
               the rest short of hovering for the title tooltip, which
               doesn't work on touch at all. Its own full-width row lets it
               wrap across as many lines as it needs instead. */}
              {(error || submitError) && (
                <div className="error-msg" role="alert">
                  <WarningIcon />
                  <span>{error || submitError}</span>
                </div>
              )}
              <div className="wizard-footer-nav">
                <button className="btn btn-ghost" onClick={goBack} disabled={stepIndex === 0 || submitting}>
                  Back
                </button>
                {isModeChoice ? null : !isLast ? (
                  <button className="btn btn-primary" onClick={goNext} disabled={checkingEmail}>
                    {checkingEmail ? "Checking…" : "Next"}
                  </button>
                ) : (
                  <button className="btn btn-primary" onClick={submit} disabled={submitting}>
                    {submitting ? "Submitting..." : "Submit audit"}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
      {wonPrize && submittedId && (
        <PrizeWheel prize={wonPrize} onDone={() => router.push(`/report/${submittedId}`)} />
      )}
    </>
  );
}

// A field labeled "... AED (2)" should only ever show AED 2's own reference
// photo, never every brand the responder owns. `sequence` is the ordered
// per-unit model list from getAedModelSequence (e.g. ["frx", "frx",
// "zollPlus"] for 2x FRx + 1x ZOLL). Falls back to the full selected-models
// list when the field isn't tied to a unit number, or the sequence doesn't
// (yet) cover that unit — e.g. the responder hasn't finished the AED Status
// step, or navigated back and shrank their reported count — so a badge still
// shows something useful instead of silently disappearing.
function WarningIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path
        d="M10 2.5 18 17H2L10 2.5Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M10 8v4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="10" cy="14.2" r="0.9" fill="currentColor" />
    </svg>
  );
}

// Traffic-light urgency for an auto-detected expiry tier (battery/pad expiry
// status), matching the gt2y/1to2y/gt6m/within6m/within1m/within1w/expired
// values from computeExpiryTierValue in genericScoring.js: plenty of runway
// is green, under a year (including the two finer near-term tiers) is a
// yellow heads-up, already expired is red.
function expiryTierClass(tierValue) {
  if (tierValue === "expired") return "notready";
  if (tierValue === "gt6m" || tierValue === "within6m" || tierValue === "within1m" || tierValue === "within1w") return "warn";
  return "ready"; // gt2y, 1to2y
}

// Client-provided compliance copy (not our own wording) for the derived
// expiry-status callout — battery and pads get their own message per tier
// rather than a bare tier label, and the pads copy keeps the client's own
// "Keep it in Packed condition to pass Pads integrity Test" line on every
// pads tier, matching how it was given. The client only wrote out expired /
// within-6-months / 1-2-years explicitly; within1w and within1m reuse the
// within-6-months wording (both are genuinely "within 6 months", just more
// urgent slices of it) and gt6m/gt2y extend the "good to go" wording with
// an accurate time phrase rather than reusing "1-2 years" for a timeframe
// that isn't actually 1-2 years — a mismatch here would be the same kind of
// bug as the earlier same-year-different-tier one.
const BATTERY_EXPIRY_MESSAGES = {
  expired: "Battery Expiry outside Shelf Life: We Advise to Replace it immediately.",
  within1w: "Battery Expiring within the next week — We Advise to prepare for the Replacement before the end of Expiry.",
  within1m: "Battery Expiring within the next month — We Advise to prepare for the Replacement before the end of Expiry.",
  within6m: "Battery Expiring Within next 6 months — We Advise to prepare for the Replacement before the end of Expiry.",
  gt6m: "Battery Expiring in more than 6 months. This is good to go.",
  "1to2y": "Battery Expiring in next 1-2 years. This is good to go.",
  gt2y: "Battery Expiring in more than 2 years. This is good to go.",
};

const PADS_EXPIRY_MESSAGES = {
  expired: "AED Electrode Pads has Expired, We Advise to Replace it immediately.",
  within1w: "AED Electrode Pads Expiring within the next week, We Advise to prepare for the Replacement before the end of Expiry. Keep it in Packed condition to pass Pads integrity Test.",
  within1m: "AED Electrode Pads Expiring within the next month, We Advise to prepare for the Replacement before the end of Expiry. Keep it in Packed condition to pass Pads integrity Test.",
  within6m: "AED Electrode Pads Expiring Within next 6 months, We Advise to prepare for the Replacement before the end of Expiry. Keep it in Packed condition to pass Pads integrity Test.",
  gt6m: "AED Electrode Pads Expiring in more than 6 months. This is good to go. Keep it in Packed condition to pass Pads integrity Test.",
  "1to2y": "AED Electrode Pads Expiring in next 1-2 years. This is good to go. Keep it in Packed condition to pass Pads integrity Test.",
  gt2y: "AED Electrode Pads Expiring in more than 2 years. This is good to go. Keep it in Packed condition to pass Pads integrity Test.",
};

function expiryStatusMessage(questionLabel, tierValue) {
  const label = (questionLabel || "").toLowerCase();
  const table = label.includes("pad") ? PADS_EXPIRY_MESSAGES : BATTERY_EXPIRY_MESSAGES;
  return table[tierValue] || null;
}

// Client-provided compliance copy, same as the expiry messages above —
// combines the two AED Responder Training questions (last-trained recency
// and how many people were in that session) into one status message, shown
// once both are answered. The client's own text used the exact same
// "enough trained Responders" line for every headcount from 15-30 up
// through 100+ — reviewed live and flagged as reading like the headcount
// answer didn't matter at all. Composed per (recency x headcount) instead
// of a flat "low vs ok" split, so every headcount bucket says something
// distinct while keeping the client's own sentence structure and the
// exact wording he gave for the recency framing and the 0-15 warning case.
const TRAINING_RECENCY_INTRO = {
  "12": null,
  "12-24": "Looks like you have not trained in last one year.",
  "24-36": "Looks like you have not trained in last two years.",
  over36: "Looks like you have not trained in last three years.",
};
const TRAINING_RECENCY_SUFFIX = {
  "12": "",
  "12-24": "",
  "24-36": " Immediate Training Advised",
  over36: " Immediate Training Advised",
};
const TRAINING_HEADCOUNT_PHRASE = {
  "15-30": "You have a modest number of trained responders.",
  "30-50": "You have a good number of trained responders.",
  "50-100": "You have a strong number of trained responders.",
  "100+": "You have an excellent number of trained responders.",
};

function trainingStatusMessage(recencyValue, headcountValue) {
  const intro = TRAINING_RECENCY_INTRO[recencyValue];
  const suffix = TRAINING_RECENCY_SUFFIX[recencyValue];
  if (intro === undefined || suffix === undefined) return null;

  if (headcountValue === "0-15") {
    if (recencyValue === "12") {
      return `Congratulations for conducting the training but you got a low number of Trained responders! We advise to maintain 20% people Trained in your Organisation.${suffix}`;
    }
    return `${intro} Also you got a low number of Trained responders! We advise to maintain 20% people Trained in your Organisation.${suffix}`;
  }

  const headcountPhrase = TRAINING_HEADCOUNT_PHRASE[headcountValue];
  if (!headcountPhrase) return null;
  if (recencyValue === "12") {
    return `Congratulations for conducting the training! ${headcountPhrase} We advise to maintain 20% people Trained in your Organisation.`;
  }
  return `${intro} ${headcountPhrase} We advise to maintain 20% people Trained in your Organisation.${suffix}`;
}

function trainingStatusClass(recencyValue, headcountValue) {
  if (recencyValue === "24-36" || recencyValue === "over36") return "notready"; // "Immediate Training Advised"
  if (headcountValue === "0-15") return "warn";
  return "ready";
}

function referenceModelsFor(question, sequence, fallbackModels) {
  const unit = unitNumberFromLabel(question.label);
  if (unit == null) return fallbackModels;
  const model = sequence[unit - 1];
  return model ? [model] : fallbackModels;
}

// Unlike referenceModelsFor above, this deliberately has no fallback to
// "every selected model" — decoding a serial number only makes sense
// against the one specific unit it was typed in for. If that unit's model
// can't be resolved yet (e.g. the model quantity question isn't answered
// yet), the honest answer is "don't know", not "guess against all of them".
function unitModelFor(question, sequence) {
  const unit = unitNumberFromLabel(question.label);
  if (unit == null) return null;
  return sequence[unit - 1] || null;
}

// Copy + severity styling per age tier — the tier itself comes from
// aedAgeStatus in lib/aedSerialDate.js, computed off the actual decoded
// age rather than a fixed calendar year, so this stays correct no matter
// what today's date actually is (a hardcoded "if year is 2016-2020" message
// would quietly go stale the moment the calendar moved on).
function aedAgeMessage(status) {
  const { year, ageYears, tier } = status;
  const ageText = `roughly ${ageYears} year${ageYears === 1 ? "" : "s"} old`;
  if (tier === "current" || tier === "borderline") {
    return {
      calloutClass: "ready",
      text: `This unit's serial number decodes to ${year} — ${ageText}. This AED should still be within warranty. You may proceed with the inspection.`,
    };
  }
  if (tier === "aging") {
    return {
      calloutClass: "warn",
      text: `This unit's serial number decodes to ${year} — ${ageText}. This AED is past warranty under company policy (5-year replacement cycle) and may not meet the latest AHA guidelines — we recommend scheduling a replacement. AEDs are typically usable for around 10 years when well maintained, so you may still proceed with the inspection.`,
    };
  }
  // tier === "expired"
  return {
    calloutClass: "notready",
    text: `This unit's serial number decodes to ${year} — ${ageText}. This AED is well past warranty under company policy (5-year replacement cycle) and has likely exceeded its typical ~10-year service life — we strongly recommend scheduling a replacement. You may still proceed with the inspection.`,
  };
}

// Placeholder examples are only worth showing where a field actually has a
// format a responder could get wrong (email, phone, serial number) — that's
// the real enterprise-form convention (Stripe's "you@example.com", etc.),
// not a blanket "every field gets an e.g.". A plain name field has no
// format to get wrong, so an example there is just noise, not a guardrail.
const IDENTITY_PLACEHOLDERS = {
  email: "you@example.com",
};

// An option photo (battery-attached, cabinet, etc.) now doubles as its own
// reference photo — a small corner badge opens it full-size instead of a
// separate, always-visible "Your reference photo" row underneath repeating
// the exact same image. Only real photos get the badge; a flat SVG
// pictogram has nothing worth zooming into. The badge is a real <button>,
// not just a click handler on the image, specifically so tapping it never
// also toggles the radio/checkbox this art sits inside — a nested
// interactive element inside a <label> is never forwarded the label's own
// "activate the wrapped control" click, by spec, regardless of where else
// the click bubbles.
function ZoomableOptionArt({ src, alt, onZoom }) {
  const photo = isPhotoUrl(src);
  return (
    <span className={`icon-card-art-zoomable${photo ? "" : " is-icon-art"}`}>
      <OptionImage src={src} alt={alt} />
      {photo && (
        <button
          type="button"
          className="icon-card-zoom-btn"
          aria-label={`View larger: ${alt}`}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onZoom();
          }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
            <circle cx="10.5" cy="10.5" r="6.5" />
            <path d="M20 20l-4.7-4.7" />
          </svg>
        </button>
      )}
    </span>
  );
}

function QuestionBlock({ question, aiInfo, answers, setAnswer, setRadioAnswer, setCheckboxAnswer, setQuantityAnswer, setFreeText, selectedAedModels, aedModelSequence, selectedCity, onCityChange, trainingRecencyValue }) {
  // A photo option (battery-attached, cabinet, etc.) is now the reference
  // photo itself — tapping the small zoom badge on its corner opens this
  // instead of a separate, always-visible "Your reference photo" row
  // underneath duplicating the exact same image. One preview slot per
  // question is enough since only one card can be zoomed at a time.
  const [zoomPreview, setZoomPreview] = useState(null);
  const max = questionMax(question);
  const hasImages = question.options?.some((o) => o.imageUrl);
  const name = `q${question.id}`;
  const refKind = referenceKindFor(question);
  const refModels = refKind ? referenceModelsFor(question, aedModelSequence || [], selectedAedModels) : null;
  const isSerialField = refKind === "serial";
  const serialUnitModel = isSerialField ? unitModelFor(question, aedModelSequence || []) : null;
  const ageStatus = isSerialField ? aedAgeStatus(serialUnitModel, answers[question.id]) : null;
  const ageMessage = ageStatus ? aedAgeMessage(ageStatus) : null;
  // battery_attached/pads_connected/readyIndicator are all seeded with a
  // fixed pair of real Philips FRx photos — right for an FRx unit, wrong
  // for any other reported model. Swaps in that unit's own real photo when
  // one's been sourced (see MODEL_PHOTOS in ReferenceGuide.jsx), or a
  // brand-agnostic generic icon for "No"/"red" otherwise, rather than
  // showing every unit the same FRx-specific photos regardless of its
  // actual model.
  const isAttachedField = refKind === "batteryAttached" || refKind === "padsAttached" || refKind === "readyIndicator";
  // "damage" has no seeded default that's "correct for one specific model
  // and wrong for the rest" the way battery/pads did — the seed is a
  // brand-neutral 3-photo composite (see migrateOptionImagesRound4 in
  // lib/db.js). So unlike isAttachedField above, this always prefers a
  // per-model photo when one exists, for every model including frx,
  // rather than only overriding when the model "differs" from a baked-in
  // default.
  const isDamageField = refKind === "damage";
  const perUnitModel = isAttachedField || isDamageField ? unitModelFor(question, aedModelSequence || []) : null;
  const attachedModelDiffers = isAttachedField && Boolean(perUnitModel) && perUnitModel !== "frx";
  function resolvedOptionImage(o) {
    if (isDamageField) {
      if (o.value === "yes") return photoForModel(perUnitModel, "damage") || o.imageUrl;
      // No dedicated "good condition" photo exists per model — reusing the
      // pads-attached photo instead of sourcing a new one: it's already a
      // real, clean shot of that exact model with nothing broken or
      // missing, which is exactly what "good condition" needs to show.
      if (o.value === "no") return photoForModel(perUnitModel, "padsAttached") || o.imageUrl;
    }
    if (!attachedModelDiffers) return o.imageUrl;
    if (o.value === "yes" || o.value === "green") return photoForModel(perUnitModel, refKind) || o.imageUrl;
    if (o.value === "no" || o.value === "red") {
      const notAttachedKind = NOT_ATTACHED_KIND[refKind];
      return photoForModel(perUnitModel, notAttachedKind) || GENERIC_NOT_ATTACHED_ICON[refKind] || o.imageUrl;
    }
    return o.imageUrl;
  }
  const serialValue = answers[question.id];
  // Only flagged once the field has something in it — an empty required
  // field is already caught by validateSection on Next, and flashing a
  // format error before the responder has typed anything would just be
  // noise. Only checked for the three brands with a verified format (see
  // lib/aedSerialDate.js); other models show no hint and are never blocked.
  const serialFormatHint = isSerialField ? aedSerialFormatHint(serialUnitModel) : null;
  const serialExample = isSerialField ? aedSerialExample(serialUnitModel) : null;
  const serialFormatInvalid =
    isSerialField && serialValue && serialUnitModel && !isValidAedSerialFormat(serialUnitModel, serialValue);
  // Lazy-initialized once per mounted instance (this component remounts
  // when the wizard navigates back to this step, so re-deriving from the
  // stored answer here — rather than always defaulting to India — is what
  // makes a previously-picked country stick on Back/Next).
  const [phoneCountryIso, setPhoneCountryIso] = useState(() => {
    const parsed = parsePhoneValueLenient(answers[question.id]);
    return parsed ? parsed.country.iso : DEFAULT_COUNTRY_ISO;
  });
  const phoneParsed = parsePhoneValueLenient(answers[question.id]);
  const phoneLocalDigits = phoneParsed ? phoneParsed.digits : "";
  // The field itself always stays a normal, editable input underneath this
  // — a bad AI read is never silently trusted, only pre-filled for review.
  const aiBadge = aiInfo ? (
    <div className="ai-badge">
      Auto-detected{typeof aiInfo.confidence === "number" ? ` · ${Math.round(aiInfo.confidence * 100)}% confidence` : ""} — edit if
      needed
    </div>
  ) : null;

  if (question.type === "text" || question.type === "email" || question.type === "tel") {
    const isPhoneField = question.type === "tel" && question.fieldRole === "phone";
    const placeholder = serialExample ? `e.g. ${serialExample}` : IDENTITY_PLACEHOLDERS[question.fieldRole] || undefined;
    return (
      <>
        {aiBadge}
        <QBlock label={question.label} required={question.required} hint={question.hint} fieldId={question.id}>
          <div className={refKind ? "field-with-ref" : undefined}>
            {isPhoneField ? (
              <div className="tel-input-group">
                <select
                  className="tel-country-select"
                  aria-label="Country code"
                  value={phoneCountryIso}
                  onChange={(e) => {
                    const iso = e.target.value;
                    setPhoneCountryIso(iso);
                    setAnswer(
                      question.id,
                      phoneLocalDigits ? composePhoneValue(iso, sanitizeLocalDigits(iso, phoneLocalDigits)) : ""
                    );
                  }}
                >
                  {COUNTRY_CODES.map((c) => (
                    <option key={c.iso} value={c.iso}>
                      {c.name} (+{c.dial})
                    </option>
                  ))}
                </select>
                <TextInput
                  type="tel"
                  value={phoneLocalDigits}
                  onChange={(v) => setAnswer(question.id, composePhoneValue(phoneCountryIso, sanitizeLocalDigits(phoneCountryIso, v)))}
                  ariaLabelledby={qblockLabelId(question.id)}
                  placeholder={phoneCountryIso === "IN" ? "98765 43210" : "Mobile number"}
                  maxLength={countryByIso(phoneCountryIso).maxDigits}
                />
              </div>
            ) : (
              <TextInput
                type={question.type === "email" ? "email" : "text"}
                value={answers[question.id] || ""}
                onChange={(v) => setAnswer(question.id, v)}
                ariaLabelledby={qblockLabelId(question.id)}
                placeholder={placeholder}
              />
            )}
            {refKind && <FieldReferencePhoto models={refModels} kind={refKind} />}
            {serialFormatInvalid && (
              <div className="callout warn" style={{ marginTop: 10 }}>
                {`This doesn't match this model's usual serial format: ${serialFormatHint}. Double-check it against the label.`}
              </div>
            )}
            {ageMessage && (
              <div className={`callout ${ageMessage.calloutClass}`} style={{ marginTop: 10 }}>
                {ageMessage.text}
              </div>
            )}
          </div>
        </QBlock>
      </>
    );
  }

  if (question.type === "date") {
    return (
      <>
        {aiBadge}
        <QBlock label={question.label} required={question.required} hint={question.hint} fieldId={question.id}>
          <div className={refKind ? "field-with-ref" : undefined}>
            <TextInput
              type="date"
              value={answers[question.id] || ""}
              onChange={(v) => setAnswer(question.id, v)}
              ariaLabelledby={qblockLabelId(question.id)}
            />
            {refKind && <FieldReferencePhoto models={refModels} kind={refKind} />}
          </div>
        </QBlock>
      </>
    );
  }

  if (question.type === "scale") {
    return (
      <QBlock label={question.label} required={question.required}>
        <LinearScale
          value={answers[question.id] ?? null}
          onChange={(v) => setAnswer(question.id, v)}
          min={question.scaleMin || 1}
          max={question.scaleMax || 5}
          minLabel={question.scaleMinLabel}
          maxLabel={question.scaleMaxLabel}
        />
      </QBlock>
    );
  }

  if (question.type === "select") {
    const val = answers[question.id]?.value || "";
    const selectedOpt = question.options.find((o) => o.value === val);
    // The hotel list is ~160 free-text names, not a handful of fixed
    // choices — a plain <select> can't show a brand logo next to an
    // <option> (no such thing exists in HTML), so this one field gets a
    // custom searchable combobox instead. Every other "select" question
    // (AED count, training headcount, etc.) stays a native select.
    const isHotelSelect = question.fieldRole === "hotel";
    // Short fixed lists (training headcount, etc.) scan faster as tabs than
    // as a dropdown that has to be opened first — a longer list like the
    // 10-option AED count still gets the native select rather than a tab
    // row wrapping across two or three lines.
    const isTabSelect = !isHotelSelect && question.options.length <= 6;
    return (
      <QBlock label={question.label} required={question.required} points={max || null} hint={question.hint} fieldId={question.id}>
        {isHotelSelect ? (
          <HotelSelect
            value={val}
            onChange={(v) => setRadioAnswer(question, v)}
            options={sortHotelOptionsByCity(
              question.options.map((o) => ({ value: o.value, label: o.label })),
              selectedCity
            )}
            placeholder="Search and select your hotel..."
          />
        ) : isTabSelect ? (
          <TabSelect
            value={val}
            onChange={(v) => setRadioAnswer(question, v)}
            options={question.options.map((o) => ({ value: o.value, label: o.label }))}
          />
        ) : (
          <Select
            value={val}
            onChange={(v) => setRadioAnswer(question, v)}
            options={question.options.map((o) => ({ value: o.value, label: o.label }))}
            placeholder="Select..."
            ariaLabelledby={qblockLabelId(question.id)}
          />
        )}
        {selectedOpt?.allowFreeText && (
          <div style={{ marginTop: 10 }}>
            <TextInput
              value={answers[question.id]?.freeText || ""}
              onChange={(v) => setFreeText(question, null, v)}
              placeholder="Please specify"
            />
          </div>
        )}
        {question.fieldRole === "training_headcount" && val && trainingRecencyValue && (
          <div className={`callout ${trainingStatusClass(trainingRecencyValue, val)}`} style={{ marginTop: 10 }}>
            {trainingStatusMessage(trainingRecencyValue, val)}
          </div>
        )}
      </QBlock>
    );
  }

  if (question.type === "radio" && question.derivedFromDateQuestionId) {
    const val = answers[question.id]?.value || "";
    const selectedOpt = question.options.find((o) => o.value === val);
    const dateFilled = !!answers[question.derivedFromDateQuestionId];
    return (
      <QBlock label={question.label} required={question.required} points={max || null}>
        {selectedOpt ? (
          <div className={`callout ${expiryTierClass(val)}`} style={{ margin: 0 }}>
            {expiryStatusMessage(question.label, val) || <b>{selectedOpt.label}</b>}
          </div>
        ) : (
          <div className="callout" style={{ margin: 0 }}>
            {dateFilled ? "Detecting…" : "Enter the date above to auto-detect this."}
          </div>
        )}
      </QBlock>
    );
  }

  if (question.type === "radio") {
    const val = answers[question.id]?.value || "";
    const selectedOpt = question.options.find((o) => o.value === val);
    return (
      <>
        {aiBadge}
        <QBlock label={question.label} required={question.required} points={max || null} hint={question.hint}>
          {hasImages ? (
            <IconRadioGrid
              name={name}
              value={val}
              onChange={(v) => setRadioAnswer(question, v)}
              wide={question.options.length <= 2}
              pair={question.options.length === 2 && !question.options.some((o) => o.sub)}
              items={question.options.map((o) => {
                const src = resolvedOptionImage(o);
                return {
                  value: o.value,
                  label: o.label,
                  sub: o.sub,
                  art: <ZoomableOptionArt src={src} alt={o.label} onZoom={() => setZoomPreview({ photo: src, caption: o.label })} />,
                };
              })}
            />
          ) : (
            <RadioGroup
              name={name}
              value={val}
              onChange={(v) => setRadioAnswer(question, v)}
              row={question.options.length <= 2 && !question.options.some((o) => o.sub)}
              options={question.options.map((o) => ({ value: o.value, label: o.label, sub: o.sub }))}
            />
          )}
          {selectedOpt?.allowFreeText && (
            <div style={{ marginTop: 10 }}>
              <TextInput
                value={answers[question.id]?.freeText || ""}
                onChange={(v) => setFreeText(question, null, v)}
                placeholder="Please specify"
              />
            </div>
          )}
          <ImageLightbox item={zoomPreview} kind="photo" labelKey="caption" onClose={() => setZoomPreview(null)} />
        </QBlock>
      </>
    );
  }

  if (question.type === "checkbox") {
    const cur = answers[question.id] || { selections: {}, freeText: {} };
    const limit = maxSelectionsFor(question, answers);
    const selectedCount = Object.values(cur.selections).filter(Boolean).length;
    const atLimit = Number.isFinite(limit) && limit > 1 && selectedCount >= limit;
    const disabledKeys = new Set(atLimit ? question.options.map((o) => o.value) : []);
    const hint =
      Number.isFinite(limit) && limit > 0
        ? `Select exactly ${limit} option${limit === 1 ? "" : "s"}.`
        : question.hint || "Select all that apply.";

    return (
      <QBlock label={question.label} required={question.required} points={max || null} hint={hint}>
        {hasImages ? (
          <IconCheckboxGrid
            value={cur.selections}
            onToggle={(k, checked) => setCheckboxAnswer(question, k, checked)}
            disabledKeys={disabledKeys}
            items={question.options.map((o) => ({
              key: o.value,
              label: o.label,
              sub: o.sub,
              art: (
                <ZoomableOptionArt
                  src={o.imageUrl}
                  alt={o.label}
                  onZoom={() => setZoomPreview({ photo: o.imageUrl, caption: o.label })}
                />
              ),
            }))}
          />
        ) : (
          <CheckboxList
            value={cur.selections}
            onToggle={(k, checked) => setCheckboxAnswer(question, k, checked)}
            disabledKeys={disabledKeys}
            items={question.options.map((o) => [o.value, o.label, o.sub])}
          />
        )}
        {Number.isFinite(limit) && limit > 0 && (
          <p className="qhint">
            {selectedCount} of {limit} selected{atLimit ? " — maximum reached, uncheck one to swap." : ""}
          </p>
        )}
        {question.options
          .filter((o) => o.allowFreeText && cur.selections?.[o.value])
          .map((o) => (
            <div key={o.value} style={{ marginTop: 10 }}>
              <TextInput
                value={cur.freeText?.[o.value] || ""}
                onChange={(v) => setFreeText(question, o.value, v)}
                placeholder={`Name the ${o.label.toLowerCase()}`}
              />
            </div>
          ))}
        <ImageLightbox item={zoomPreview} kind="photo" labelKey="caption" onClose={() => setZoomPreview(null)} />
      </QBlock>
    );
  }

  if (question.type === "quantity") {
    const cur = answers[question.id] || { quantities: {}, freeText: {} };
    const limit = maxSelectionsFor(question, answers);
    const total = Object.values(cur.quantities).reduce((s, n) => s + (n || 0), 0);
    const hint = Number.isFinite(limit) && limit > 0 ? `Quantities must add up to ${limit} — same model twice is fine.` : question.hint;

    return (
      <QBlock label={question.label} required={question.required} points={max || null} hint={hint}>
        <IconQuantityGrid
          value={cur.quantities}
          max={limit}
          onChange={(k, qty) => setQuantityAnswer(question, k, qty)}
          items={question.options.map((o) => ({
            key: o.value,
            label: o.label,
            sub: o.sub,
            art: (
              <ZoomableOptionArt
                src={o.imageUrl}
                alt={o.label}
                onZoom={() => setZoomPreview({ photo: o.imageUrl, caption: o.label })}
              />
            ),
          }))}
        />
        {Number.isFinite(limit) && limit > 0 && (
          <p className="qhint">
            {total} of {limit} accounted for{total >= limit ? " — maximum reached." : ""}
          </p>
        )}
        {question.options
          .filter((o) => o.allowFreeText && cur.quantities?.[o.value] > 0)
          .map((o) => (
            <div key={o.value} style={{ marginTop: 10 }}>
              <TextInput
                value={cur.freeText?.[o.value] || ""}
                onChange={(v) => setFreeText(question, o.value, v)}
                placeholder={`Name the ${o.label.toLowerCase()}`}
              />
            </div>
          ))}
        <ImageLightbox item={zoomPreview} kind="photo" labelKey="caption" onClose={() => setZoomPreview(null)} />
      </QBlock>
    );
  }

  return null;
}
etZoomPreview(null)} />
      </QBlock>
    );
  }

  return null;
}
