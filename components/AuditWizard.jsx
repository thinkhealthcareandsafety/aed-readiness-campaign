"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { QBlock, RadioGroup, CheckboxList, IconRadioGrid, IconCheckboxGrid, IconQuantityGrid, TextInput, Select, TabSelect, LinearScale } from "@/components/fields";
import { OptionImage } from "@/components/OptionImage";
import { FieldReferencePhoto, PaediatricReferencePhoto, CabinetReferencePhoto, referenceKindFor, unitNumberFromLabel } from "@/components/ReferenceGuide";
import AutoInspection from "@/components/AutoInspection";
import { HotelSelect } from "@/components/HotelSelect";
import { logoForHotel } from "@/lib/hotelBrands";
import Landing from "@/components/Landing";
import LiveScore from "@/components/LiveScore";
import PrizeWheel from "@/components/PrizeWheel";
import { CHECKLIST_ITEMS } from "@/lib/inspectionChecklist";
import { listHotelCities, sortHotelOptionsByCity } from "@/lib/hotelCities";
import { isSectionVisible, maxSelectionsFor, validateSection, questionMax, extractIdentity, resolveDerivedAnswers, expandUnitQuestions, getSelectedAedModels, getAedModelSequence, getModelLabelMap, scoreSubmission } from "@/lib/genericScoring";
import { aedAgeWarning, isValidAedSerialFormat, aedSerialFormatHint, MONTH_NAMES } from "@/lib/aedSerialDate";

const REVIEW_STEP = { id: "__review", letter: "✓", title: "Review & Submit", note: "Check your answers, then send the audit.", questions: [] };

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

// Small override control shown above the hotel picker: "Showing: {city} ▾"
// — the picker itself already sorts that city's hotels to the top, this
// just lets the responder pick a different one (e.g. auditing a property
// outside their own city).
function CityPill({ cities, selected, onChange }) {
  if (!cities.length) return null;
  return (
    <label className="city-pill">
      <span className="city-pill-label">Showing:</span>
      <select value={selected || ""} onChange={(e) => onChange(e.target.value || null)}>
        {!selected && <option value="">All cities</option>}
        {cities.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
    </label>
  );
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
      return resolveDerivedAnswers(expandUnitQuestions(schema, next), next);
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
    for (const item of CHECKLIST_ITEMS) {
      const result = results[item.id];
      if (!result || (result.status !== "pass" && result.status !== "fail")) continue;
      const q = findQuestionByFieldRole(expandedSchema, item.id);
      if (!q) continue;

      if (item.id === "battery_expiry_date_1" || item.id === "pads_expiry_date_1") {
        if (!result.expiry_date) continue;
        // A month-only read ("YYYY-MM") needs a day for the <input type=date>
        // — default to the 1st; it's a starting point the responder reviews
        // and can correct, not a claim about the real expiry day.
        setAnswer(q.id, result.expiry_date.length === 7 ? `${result.expiry_date}-01` : result.expiry_date);
      } else if (item.id === "battery_attached" || item.id === "pads_connected" || item.id === "aed_cabinet_ok") {
        setRadioAnswer(q, result.passed ? "yes" : "no");
      } else if (item.id === "readiness_indicator") {
        if (result.readinessStatus !== "ready" && result.readinessStatus !== "fault") continue; // "unclear" — leave for manual
        setRadioAnswer(q, result.readinessStatus === "ready" ? "green" : "red");
      } else {
        continue;
      }
      aiInfoUpdates[q.id] = result;
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
          const res = await fetch("/api/submissions/check-email", {
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
      const res = await fetch("/api/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers }),
      });
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
      setSubmitError(err instanceof Error ? err.message : "Something went wrong sending your audit. Please try again.");
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
          {hotelBrand && (
            <div className="hotel-badge">
              {/* eslint-disable-next-line @next/next/no-img-element -- static bundled brand mark, no next/image needed */}
              <img src={hotelBrand.logo} alt="" className="hotel-badge-logo" />
              <span className="hotel-badge-name">{identity.hotel}</span>
            </div>
          )}
          <div className="topbar-meta">
            {!isModeChoice && <LiveScore points={scored.total.points} max={scored.total.max} />}
            <div className="step-label">
              Step {stepIndex + 1} / {steps.length}
            </div>
          </div>
        </div>
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
          <p className="section-note">
            {step.title === "Expiry Status" ? expiryStatusNote(aedModelSequence.length) : step.note}
          </p>
          {step.title === "Paediatric Readiness" && <PaediatricReferencePhoto models={selectedAedModels} />}

          {isReview ? (
            <div className="callout ready">
              Thanks, {identity.firstName || "there"} — everything&rsquo;s filled in for{" "}
              <b>{identity.hotel || "your hotel"}</b>. Press <b>Submit audit</b> below to save this response and see
              your PREPARED score and detailed AED report.
            </div>
          ) : isModeChoice ? (
            autoScanActive ? (
              <AutoInspection onComplete={handleAutoInspectionComplete} onCancel={() => setAutoScanActive(false)} />
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
              return step.questions.map((q) => {
                const unit = unitNumberFromLabel(q.label);
                const isNewUnit = unit != null && unit !== lastUnit;
                if (unit != null) lastUnit = unit;
                const unitModel = isNewUnit ? aedModelSequence[unit - 1] : null;
                const unitModelLabel = unitModel ? modelLabelByValue[unitModel] : null;
                return (
                  <div key={q.id} id={`q-field-${q.id}`}>
                    {isNewUnit && (
                      <div className="unit-banner">
                        AED ({unit}){unitModelLabel ? ` — ${unitModelLabel}` : ""}
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
                    />
                  </div>
                );
              });
            })()
          )}
        </div>
      </div>

      {!autoScanActive && (
        <div className="wizard-footer">
          <div className="inner">
            <button className="btn btn-ghost" onClick={goBack} disabled={stepIndex === 0 || submitting}>
              Back
            </button>
            {error && (
              <span className="error-msg" role="alert" title={error}>
                <WarningIcon />
                <span>{error}</span>
              </span>
            )}
            {submitError && (
              <span className="error-msg" role="alert" title={submitError}>
                <WarningIcon />
                <span>{submitError}</span>
              </span>
            )}
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
// status), matching the gt2y/1to2y/gt6m/within6m/expired values from
// computeExpiryTierValue in genericScoring.js: plenty of runway is green,
// under a year is a yellow heads-up, already expired is red.
// The DB-seeded note for "Expiry Status" originally read "Scored on AED
// (1). AED (2) is optional inventory only." — accurate back when a second
// AED was only a maybe, but expandUnitQuestions now scores every unit the
// responder actually reported (see genericScoring.js), so that copy became
// misleading the moment someone reported 2+ units. Overridden here instead
// of edited in the DB so it stays correct for any reported count, not just
// the 1-vs-2 case a static string could describe.
function expiryStatusNote(unitCount) {
  if (unitCount <= 1) return "Every field below is scored.";
  return `You reported ${unitCount} AEDs — every one is scored below, not just the first.`;
}

function expiryTierClass(tierValue) {
  if (tierValue === "expired") return "notready";
  if (tierValue === "gt6m" || tierValue === "within6m") return "warn";
  return "ready"; // gt2y, 1to2y
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

function QuestionBlock({ question, aiInfo, answers, setAnswer, setRadioAnswer, setCheckboxAnswer, setQuantityAnswer, setFreeText, selectedAedModels, aedModelSequence, selectedCity, onCityChange }) {
  const max = questionMax(question);
  const hasImages = question.options?.some((o) => o.imageUrl);
  const name = `q${question.id}`;
  const refKind = referenceKindFor(question);
  const refModels = refKind ? referenceModelsFor(question, aedModelSequence || [], selectedAedModels) : null;
  const isSerialField = refKind === "serial";
  const serialUnitModel = isSerialField ? unitModelFor(question, aedModelSequence || []) : null;
  const ageWarning = isSerialField ? aedAgeWarning(serialUnitModel, answers[question.id]) : null;
  const serialValue = answers[question.id];
  // Only flagged once the field has something in it — an empty required
  // field is already caught by validateSection on Next, and flashing a
  // format error before the responder has typed anything would just be
  // noise. Only checked for the three brands with a verified format (see
  // lib/aedSerialDate.js); other models show no hint and are never blocked.
  const serialFormatHint = isSerialField ? aedSerialFormatHint(serialUnitModel) : null;
  const serialFormatInvalid =
    isSerialField && serialValue && serialUnitModel && !isValidAedSerialFormat(serialUnitModel, serialValue);
  // The field itself always stays a normal, editable input underneath this
  // — a bad AI read is never silently trusted, only pre-filled for review.
  const aiBadge = aiInfo ? (
    <div className="ai-badge">
      Auto-detected{typeof aiInfo.confidence === "number" ? ` · ${Math.round(aiInfo.confidence * 100)}% confidence` : ""} — edit if
      needed
    </div>
  ) : null;

  if (question.type === "text" || question.type === "email" || question.type === "tel") {
    return (
      <>
        {aiBadge}
        <QBlock label={question.label} required={question.required} hint={question.hint}>
          <div className={refKind ? "field-with-ref" : undefined}>
            <TextInput
              type={question.type === "email" ? "email" : question.type === "tel" ? "tel" : "text"}
              value={answers[question.id] || ""}
              onChange={(v) => setAnswer(question.id, v)}
            />
            {refKind && <FieldReferencePhoto models={refModels} kind={refKind} />}
            {serialFormatInvalid && (
              <div className="callout warn" style={{ marginTop: 10 }}>
                {`This doesn't match this model's usual serial format: ${serialFormatHint}. Double-check it against the label.`}
              </div>
            )}
            {ageWarning && (
              // Built as one JS template literal, not multi-line JSX text —
              // JSX collapses a text run that wraps across source lines by
              // trimming *each* line's leading/trailing whitespace before
              // rejoining, which silently ate the space right after
              // {ageWarning.ageYears} when it was plain JSX text starting a
              // new line ("9" + "years" with no space between). A single
              // template-literal expression is immune to that since it's
              // one JS string, not JSX-text-with-line-wraps.
              <div className="callout notready" style={{ marginTop: 10 }}>
                {`This unit's serial number decodes to ${MONTH_NAMES[ageWarning.month - 1]} ${ageWarning.year} — ${ageWarning.ageYears} years old. This AED is expired under company policy (5-year replacement cycle) and should be scheduled for replacement.`}
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
        <QBlock label={question.label} required={question.required} hint={question.hint}>
          <div className={refKind ? "field-with-ref" : undefined}>
            <TextInput type="date" value={answers[question.id] || ""} onChange={(v) => setAnswer(question.id, v)} />
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
      <QBlock label={question.label} required={question.required} points={max || null} hint={question.hint}>
        {isHotelSelect ? (
          <>
            <CityPill
              cities={listHotelCities()}
              selected={selectedCity}
              onChange={onCityChange}
            />
            <HotelSelect
              value={val}
              onChange={(v) => setRadioAnswer(question, v)}
              options={sortHotelOptionsByCity(
                question.options.map((o) => ({ value: o.value, label: o.label })),
                selectedCity
              )}
              placeholder="Select..."
            />
          </>
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
            <b>{selectedOpt.label}</b>
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
            items={question.options.map((o) => ({
              value: o.value,
              label: o.label,
              sub: o.sub,
              art: <OptionImage src={o.imageUrl} alt={o.label} />,
            }))}
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
        {refKind && <FieldReferencePhoto models={refModels} kind={refKind} />}
        {question.label.toLowerCase().includes("cabinet") && <CabinetReferencePhoto />}
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
              art: <OptionImage src={o.imageUrl} alt={o.label} />,
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
            art: <OptionImage src={o.imageUrl} alt={o.label} />,
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
      </QBlock>
    );
  }

  return null;
}
