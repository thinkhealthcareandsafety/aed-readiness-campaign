"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { QBlock, RadioGroup, CheckboxList, IconRadioGrid, IconCheckboxGrid, IconQuantityGrid, TextInput, Select, LinearScale } from "@/components/fields";
import { OptionImage } from "@/components/OptionImage";
import { ExpiryReferenceGuide, PaediatricReferenceGuide } from "@/components/ReferenceGuide";
import { isSectionVisible, maxSelectionsFor, validateSection, questionMax, extractIdentity, resolveDerivedAnswers, expandUnitQuestions } from "@/lib/genericScoring";

const REVIEW_STEP = { id: "__review", letter: "✓", title: "Review & Submit", note: "Check your answers, then send the audit.", questions: [] };

export default function AuditWizard({ schema }) {
  const router = useRouter();
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
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  // Without this, the browser keeps whatever scroll position you were at —
  // on mobile that's usually the bottom of the previous (longer) step, right
  // by the Next button, leaving the new step's questions off-screen above.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [stepIndex]);

  const expandedSchema = useMemo(() => expandUnitQuestions(schema, answers), [schema, answers]);
  const visibleSections = useMemo(
    () => expandedSchema.sections.filter((s) => isSectionVisible(s, answers)),
    [expandedSchema, answers]
  );
  const steps = useMemo(() => [...visibleSections, REVIEW_STEP], [visibleSections]);
  const step = steps[Math.min(stepIndex, steps.length - 1)];
  const isLast = stepIndex === steps.length - 1;
  const isReview = step.id === "__review";

  function setAnswer(questionId, value) {
    setAnswers((a) => ({ ...a, [questionId]: value }));
  }

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

  function goNext() {
    if (!isReview) {
      const err = validateSection(step, answers);
      if (err) {
        setError(err);
        return;
      }
    }
    setError(null);
    if (isLast) return;
    setStepIndex((i) => Math.min(i + 1, steps.length - 1));
  }
  function goBack() {
    setError(null);
    setStepIndex((i) => Math.max(i - 1, 0));
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
      if (!res.ok) throw new Error("Submission failed");
      const { id } = await res.json();
      router.push(`/report/${id}`);
    } catch {
      setSubmitError("Something went wrong sending your audit. Please try again.");
      setSubmitting(false);
    }
  }

  const identity = extractIdentity(schema, answers);

  return (
    <div className="wizard-page">
      <div className="wizard-topbar">
        <div className="brandrow">
          <div className="brand">
            AED Readiness Campaign
            <small>Think Health &middot; PREPARED Score</small>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
            <div className="step-label">
              Step {stepIndex + 1} / {steps.length}
            </div>
            <a href="/admin" className="admin-link">
              Admin dashboard &rarr;
            </a>
          </div>
        </div>
        <div className="step-dots">
          {steps.map((s, i) => (
            <div key={s.id} className={`dot-item${i < stepIndex ? " done" : ""}${i === stepIndex ? " current" : ""}`} />
          ))}
        </div>
      </div>

      <div className="wizard-main">
        <div className="wizard-card" key={step.id} style={{ animation: "stepFade .28s ease both" }}>
          <div className="section-eyebrow">
            <span className="letter">{step.letter}</span>
            <h2 className="section-title" style={{ marginBottom: 0 }}>
              {step.title}
            </h2>
          </div>
          <p className="section-note">{step.note}</p>
          {step.title === "Expiry Status" && <ExpiryReferenceGuide />}
          {step.title === "Paediatric Readiness" && <PaediatricReferenceGuide />}

          {isReview ? (
            <div className="callout ready">
              Thanks, {identity.firstName || "there"} — everything&rsquo;s filled in for{" "}
              <b>{identity.hotel || "your hotel"}</b>. Press <b>Submit audit</b> below to save this response and see
              your PREPARED score and detailed AED report.
            </div>
          ) : (
            step.questions.map((q) => (
              <QuestionBlock
                key={q.id}
                question={q}
                answers={answers}
                setAnswer={setAnswer}
                setRadioAnswer={setRadioAnswer}
                setCheckboxAnswer={setCheckboxAnswer}
                setQuantityAnswer={setQuantityAnswer}
                setFreeText={setFreeText}
              />
            ))
          )}
        </div>
      </div>

      <div className="wizard-footer">
        <div className="inner">
          <button className="btn btn-ghost" onClick={goBack} disabled={stepIndex === 0 || submitting}>
            Back
          </button>
          {error && <span className="error-msg">{error}</span>}
          {submitError && <span className="error-msg">{submitError}</span>}
          {!isLast ? (
            <button className="btn btn-primary" onClick={goNext}>
              Next
            </button>
          ) : (
            <button className="btn btn-primary" onClick={submit} disabled={submitting}>
              {submitting ? "Submitting..." : "Submit audit"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function QuestionBlock({ question, answers, setAnswer, setRadioAnswer, setCheckboxAnswer, setQuantityAnswer, setFreeText }) {
  const max = questionMax(question);
  const hasImages = question.options?.some((o) => o.imageUrl);
  const name = `q${question.id}`;

  if (question.type === "text" || question.type === "email" || question.type === "tel") {
    return (
      <QBlock label={question.label} required={question.required} hint={question.hint}>
        <TextInput
          type={question.type === "email" ? "email" : question.type === "tel" ? "tel" : "text"}
          value={answers[question.id] || ""}
          onChange={(v) => setAnswer(question.id, v)}
        />
      </QBlock>
    );
  }

  if (question.type === "date") {
    return (
      <QBlock label={question.label} required={question.required} hint={question.hint}>
        <TextInput type="date" value={answers[question.id] || ""} onChange={(v) => setAnswer(question.id, v)} />
      </QBlock>
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
    return (
      <QBlock label={question.label} required={question.required} points={max || null} hint={question.hint}>
        <Select
          value={val}
          onChange={(v) => setRadioAnswer(question, v)}
          options={question.options.map((o) => ({ value: o.value, label: o.label }))}
          placeholder="Select..."
        />
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
          <div className="callout ready" style={{ margin: 0 }}>
            Auto-detected: <b>{selectedOpt.label}</b>
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
      <QBlock label={question.label} required={question.required} points={max || null} hint={question.hint}>
        {hasImages ? (
          <IconRadioGrid
            name={name}
            value={val}
            onChange={(v) => setRadioAnswer(question, v)}
            wide={question.options.length <= 2}
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
      </QBlock>
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
