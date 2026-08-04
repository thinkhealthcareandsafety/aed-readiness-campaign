"use client";

import { useEffect, useMemo, useState } from "react";
import { questionMax } from "@/lib/genericScoring";

const QUESTION_TYPES = [
  { value: "radio", label: "Radio (single choice)" },
  { value: "checkbox", label: "Checkbox (multi choice)" },
  { value: "quantity", label: "Quantity (multi, repeatable)" },
  { value: "select", label: "Dropdown" },
  { value: "text", label: "Short text" },
  { value: "email", label: "Email" },
  { value: "tel", label: "Phone" },
  { value: "date", label: "Date" },
  { value: "scale", label: "Linear scale (unscored)" },
];

const FIELD_ROLES = [
  { value: "", label: "None" },
  { value: "hotel", label: "Hotel (shows in admin list)" },
  { value: "first_name", label: "First name" },
  { value: "last_name", label: "Last name" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
  { value: "has_aed_gate", label: "AED gate (drives section visibility)" },
];

async function api(url, options) {
  const res = await fetch(url, {
    method: options?.method || "GET",
    headers: options?.body ? { "Content-Type": "application/json" } : undefined,
    body: options?.body ? JSON.stringify(options.body) : undefined,
  });
  if (!res.ok) throw new Error(`Request failed: ${url}`);
  return res.json().catch(() => ({}));
}

function TextEditable({ value, onCommit, placeholder, type = "text", className = "" }) {
  const [v, setV] = useState(value || "");
  useEffect(() => setV(value ?? ""), [value]);
  return (
    <input
      type={type}
      className={className}
      value={v}
      placeholder={placeholder}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        if (v !== (value ?? "")) onCommit(v);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
    />
  );
}

function NumberEditable({ value, onCommit, className = "", placeholder }) {
  const [v, setV] = useState(value ?? "");
  useEffect(() => setV(value ?? ""), [value]);
  return (
    <input
      type="number"
      className={className}
      value={v}
      placeholder={placeholder}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        const n = v === "" ? null : parseInt(v, 10);
        if (n !== value) onCommit(n);
      }}
    />
  );
}

export default function FormBuilder({ initialSchema }) {
  const [schema, setSchema] = useState(initialSchema);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const data = await api("/api/admin/schema");
    setSchema(data.schema);
  }

  async function run(fn) {
    setBusy(true);
    try {
      await fn();
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  const allQuestions = useMemo(() => {
    const list = [];
    for (const s of schema.sections) {
      for (const q of s.questions) {
        if (q.type === "radio" || q.type === "select") list.push({ id: q.id, label: q.label, options: q.options });
      }
    }
    return list;
  }, [schema]);

  const totals = useMemo(() => {
    let prepared = 0;
    let supplementary = 0;
    for (const s of schema.sections) {
      if (s.unscored) continue;
      const max = s.questions.reduce((sum, q) => sum + questionMax(q), 0);
      if (s.isSupplementary) supplementary += max;
      else prepared += max;
    }
    return { prepared, supplementary, total: prepared + supplementary };
  }, [schema]);

  return (
    <div className="builder-page">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: "1.6rem" }}>Form Builder</h1>
          <p style={{ color: "var(--ink-soft)", fontSize: ".9rem" }}>
            Every section, question, option, image, and point value here is what respondents see live at{" "}
            <code>/</code>. Changes save immediately.
          </p>
        </div>
        {busy && <span style={{ fontSize: ".8rem", color: "var(--ink-soft)" }}>Saving…</span>}
      </div>

      <div className="builder-totals">
        <div className="cell">
          <div className="n tabular">{totals.prepared}</div>
          <div className="l">PREPARED max</div>
        </div>
        <div className="cell">
          <div className="n tabular">{totals.supplementary}</div>
          <div className="l">Supplementary max</div>
        </div>
        <div className="cell">
          <div className="n tabular">{totals.total}</div>
          <div className="l">Total possible points</div>
        </div>
      </div>

      {schema.sections.map((section, i) => (
        <SectionCard
          key={section.id}
          section={section}
          isFirst={i === 0}
          isLast={i === schema.sections.length - 1}
          allQuestions={allQuestions}
          run={run}
        />
      ))}

      <button
        className="b-add-btn"
        style={{ marginTop: 8 }}
        onClick={() => run(() => api("/api/admin/sections", { method: "POST", body: { title: "New section" } }))}
      >
        + Add section
      </button>
    </div>
  );
}

function SectionCard({ section, isFirst, isLast, allQuestions, run }) {
  const [expanded, setExpanded] = useState(false);
  const linkableQuestions = allQuestions.filter((q) => !section.questions.some((sq) => sq.id === q.id));
  const linkedQuestion = linkableQuestions.find((q) => q.id === section.visibleIfQuestionId);

  return (
    <div className="b-section">
      <div className="b-section-head">
        <button className="icon-btn" onClick={() => setExpanded((e) => !e)} title={expanded ? "Collapse" : "Expand"}>
          {expanded ? "▾" : "▸"}
        </button>
        <button className="icon-btn" disabled={isFirst} onClick={() => run(() => api(`/api/admin/sections/${section.id}/move`, { method: "POST", body: { direction: "up" } }))}>
          ↑
        </button>
        <button className="icon-btn" disabled={isLast} onClick={() => run(() => api(`/api/admin/sections/${section.id}/move`, { method: "POST", body: { direction: "down" } }))}>
          ↓
        </button>
        <TextEditable
          className="b-letter-input"
          value={section.letter}
          placeholder="P"
          onCommit={(v) => run(() => api(`/api/admin/sections/${section.id}`, { method: "PATCH", body: { letter: v } }))}
        />
        <TextEditable
          className="b-title-input"
          value={section.title}
          placeholder="Section title"
          onCommit={(v) => run(() => api(`/api/admin/sections/${section.id}`, { method: "PATCH", body: { title: v } }))}
        />
        <span style={{ fontSize: ".78rem", color: "var(--ink-soft)", whiteSpace: "nowrap" }}>
          {section.questions.length} question{section.questions.length === 1 ? "" : "s"}
        </span>
        <button
          className="icon-btn danger"
          title="Delete section"
          onClick={() => {
            if (confirm(`Delete section "${section.title}" and all its questions?`)) {
              run(() => api(`/api/admin/sections/${section.id}`, { method: "DELETE" }));
            }
          }}
        >
          ✕
        </button>
      </div>

      {expanded && (
      <>
      <div className="b-section-meta">
        <TextEditable
          value={section.note}
          placeholder="Section note (shown under the title)"
          onCommit={(v) => run(() => api(`/api/admin/sections/${section.id}`, { method: "PATCH", body: { note: v } }))}
        />
        <label>
          <input
            type="checkbox"
            checked={section.isSupplementary}
            onChange={(e) => run(() => api(`/api/admin/sections/${section.id}`, { method: "PATCH", body: { isSupplementary: e.target.checked } }))}
          />
          Supplementary
        </label>
        <label>
          <input
            type="checkbox"
            checked={section.unscored}
            onChange={(e) => run(() => api(`/api/admin/sections/${section.id}`, { method: "PATCH", body: { unscored: e.target.checked } }))}
          />
          Unscored
        </label>
        <label>
          Visible only if:
          <select
            style={{ marginLeft: 6 }}
            value={section.visibleIfQuestionId || ""}
            onChange={(e) =>
              run(() =>
                api(`/api/admin/sections/${section.id}`, {
                  method: "PATCH",
                  body: { visibleIfQuestionId: e.target.value ? Number(e.target.value) : null, visibleIfValue: e.target.value ? section.visibleIfValue || "" : null },
                })
              )
            }
          >
            <option value="">Always visible</option>
            {linkableQuestions.map((q) => (
              <option key={q.id} value={q.id}>
                {q.label}
              </option>
            ))}
          </select>
        </label>
        {section.visibleIfQuestionId && (
          <label>
            equals:
            {linkedQuestion ? (
              <select
                style={{ marginLeft: 6 }}
                value={section.visibleIfValue || ""}
                onChange={(e) => run(() => api(`/api/admin/sections/${section.id}`, { method: "PATCH", body: { visibleIfValue: e.target.value } }))}
              >
                <option value="">Select an answer</option>
                {linkedQuestion.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : (
              <TextEditable
                value={section.visibleIfValue}
                onCommit={(v) => run(() => api(`/api/admin/sections/${section.id}`, { method: "PATCH", body: { visibleIfValue: v } }))}
              />
            )}
          </label>
        )}
      </div>

      <div className="b-section-body">
        {section.questions.map((q, i) => (
          <QuestionCard
            key={q.id}
            question={q}
            isFirst={i === 0}
            isLast={i === section.questions.length - 1}
            siblingQuestions={section.questions.filter((sq) => sq.id !== q.id && (sq.type === "select" || sq.type === "radio"))}
            dateQuestions={section.questions.filter((sq) => sq.id !== q.id && sq.type === "date")}
            run={run}
          />
        ))}
        <button
          className="b-add-btn"
          onClick={() => run(() => api(`/api/admin/sections/${section.id}/questions`, { method: "POST", body: { type: "radio", label: "New question" } }))}
        >
          + Add question
        </button>
      </div>
      </>
      )}
    </div>
  );
}

function QuestionCard({ question, isFirst, isLast, siblingQuestions, dateQuestions, run }) {
  const isChoice = question.type === "radio" || question.type === "checkbox" || question.type === "select" || question.type === "quantity";
  const isScale = question.type === "scale";
  const [optionsExpanded, setOptionsExpanded] = useState(question.options.length <= 8);

  return (
    <div className="b-question">
      <div className="b-q-row">
        <button className="icon-btn" disabled={isFirst} onClick={() => run(() => api(`/api/admin/questions/${question.id}/move`, { method: "POST", body: { direction: "up" } }))}>
          ↑
        </button>
        <button className="icon-btn" disabled={isLast} onClick={() => run(() => api(`/api/admin/questions/${question.id}/move`, { method: "POST", body: { direction: "down" } }))}>
          ↓
        </button>
        <select
          className="b-type-select"
          value={question.type}
          onChange={(e) => run(() => api(`/api/admin/questions/${question.id}`, { method: "PATCH", body: { type: e.target.value } }))}
        >
          {QUESTION_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        <TextEditable
          className="b-q-label-input"
          value={question.label}
          placeholder="Question label"
          onCommit={(v) => run(() => api(`/api/admin/questions/${question.id}`, { method: "PATCH", body: { label: v } }))}
        />
        <button
          className="icon-btn danger"
          title="Delete question"
          onClick={() => {
            if (confirm("Delete this question and its options?")) {
              run(() => api(`/api/admin/questions/${question.id}`, { method: "DELETE" }));
            }
          }}
        >
          ✕
        </button>
      </div>

      <div className="b-q-row" style={{ marginTop: 6 }}>
        <TextEditable
          className="b-q-label-input"
          value={question.hint}
          placeholder="Hint text (optional)"
          onCommit={(v) => run(() => api(`/api/admin/questions/${question.id}`, { method: "PATCH", body: { hint: v } }))}
        />
      </div>

      <div className="b-q-flags">
        <label>
          <input
            type="checkbox"
            checked={question.required}
            onChange={(e) => run(() => api(`/api/admin/questions/${question.id}`, { method: "PATCH", body: { required: e.target.checked } }))}
          />
          Required
        </label>
        <label title="Excludes this question's points from the section's score entirely — use for optional/inventory-only questions.">
          <input
            type="checkbox"
            checked={question.unscored}
            onChange={(e) => run(() => api(`/api/admin/questions/${question.id}`, { method: "PATCH", body: { unscored: e.target.checked } }))}
          />
          Unscored
        </label>

        {(question.type === "checkbox" || question.type === "quantity") && (
          <>
            <label>
              {question.type === "quantity" ? "Must sum to:" : "Max selections:"}
              <NumberEditable
                value={question.maxSelectionsLinkedQuestionId ? "" : question.maxSelections}
                placeholder="none"
                onCommit={(n) => run(() => api(`/api/admin/questions/${question.id}`, { method: "PATCH", body: { maxSelections: n, maxSelectionsLinkedQuestionId: null } }))}
              />
            </label>
            <label>
              or link cap to:
              <select
                value={question.maxSelectionsLinkedQuestionId || ""}
                onChange={(e) =>
                  run(() =>
                    api(`/api/admin/questions/${question.id}`, {
                      method: "PATCH",
                      body: { maxSelectionsLinkedQuestionId: e.target.value ? Number(e.target.value) : null, maxSelections: e.target.value ? null : question.maxSelections },
                    })
                  )
                }
              >
                <option value="">(fixed number above)</option>
                {(siblingQuestions || []).map((q) => (
                  <option key={q.id} value={q.id}>
                    {q.label}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}

        {isChoice && (
          <>
            <label>
              Certificate gate:
              <input
                type="checkbox"
                checked={question.gateRole === "certificate"}
                onChange={(e) =>
                  run(() =>
                    api(`/api/admin/questions/${question.id}`, {
                      method: "PATCH",
                      body: { gateRole: e.target.checked ? "certificate" : null, gateValue: e.target.checked ? question.gateValue || "yes" : null },
                    })
                  )
                }
              />
            </label>
            {question.gateRole === "certificate" && (
              <label>
                required answer:
                <TextEditable
                  value={question.gateValue}
                  onCommit={(v) => run(() => api(`/api/admin/questions/${question.id}`, { method: "PATCH", body: { gateValue: v } }))}
                />
              </label>
            )}
            {question.type === "radio" && (
              <label title="Instead of letting the respondent pick, auto-detect the answer from a date field (e.g. expiry status from an expiry date). Option values must match: expired, within6m, gt6m, 1to2y, gt2y.">
                Auto-detect from date:
                <select
                  value={question.derivedFromDateQuestionId || ""}
                  onChange={(e) =>
                    run(() =>
                      api(`/api/admin/questions/${question.id}`, {
                        method: "PATCH",
                        body: { derivedFromDateQuestionId: e.target.value ? Number(e.target.value) : null },
                      })
                    )
                  }
                >
                  <option value="">(manual — respondent picks)</option>
                  {(dateQuestions || []).map((q) => (
                    <option key={q.id} value={q.id}>
                      {q.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </>
        )}

        {isScale && (
          <>
            <label>
              Min <NumberEditable value={question.scaleMin ?? 1} onCommit={(v) => run(() => api(`/api/admin/questions/${question.id}`, { method: "PATCH", body: { scaleMin: v } }))} />
            </label>
            <label>
              Max <NumberEditable value={question.scaleMax ?? 5} onCommit={(v) => run(() => api(`/api/admin/questions/${question.id}`, { method: "PATCH", body: { scaleMax: v } }))} />
            </label>
            <label>
              Min label
              <TextEditable value={question.scaleMinLabel} onCommit={(v) => run(() => api(`/api/admin/questions/${question.id}`, { method: "PATCH", body: { scaleMinLabel: v } }))} />
            </label>
            <label>
              Max label
              <TextEditable value={question.scaleMaxLabel} onCommit={(v) => run(() => api(`/api/admin/questions/${question.id}`, { method: "PATCH", body: { scaleMaxLabel: v } }))} />
            </label>
          </>
        )}

        <label>
          Special role:
          <select
            value={question.fieldRole || ""}
            onChange={(e) => run(() => api(`/api/admin/questions/${question.id}`, { method: "PATCH", body: { fieldRole: e.target.value || null } }))}
          >
            {FIELD_ROLES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {isChoice && (
        <div className="b-options">
          <button className="b-add-btn" style={{ marginBottom: 4 }} onClick={() => setOptionsExpanded((e) => !e)}>
            {optionsExpanded ? "▾" : "▸"} {question.options.length} option{question.options.length === 1 ? "" : "s"}
          </button>
          {optionsExpanded && (
            <>
              {question.options.map((o, i) => (
                <OptionCard key={o.id} option={o} isFirst={i === 0} isLast={i === question.options.length - 1} run={run} />
              ))}
              <button
                className="b-add-btn"
                onClick={() => run(() => api(`/api/admin/questions/${question.id}/options`, { method: "POST", body: { value: `opt-${Date.now()}`, label: "New option" } }))}
              >
                + Add option
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function OptionCard({ option, isFirst, isLast, run }) {
  const [uploading, setUploading] = useState(false);

  async function handleUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/admin/upload", { method: "POST", body: fd });
      const data = await res.json();
      if (data.url) {
        await run(() => api(`/api/admin/options/${option.id}`, { method: "PATCH", body: { imageUrl: data.url } }));
      }
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  return (
    <div className="b-option">
      <button className="icon-btn" disabled={isFirst} onClick={() => run(() => api(`/api/admin/options/${option.id}/move`, { method: "POST", body: { direction: "up" } }))}>
        ↑
      </button>
      <button className="icon-btn" disabled={isLast} onClick={() => run(() => api(`/api/admin/options/${option.id}/move`, { method: "POST", body: { direction: "down" } }))}>
        ↓
      </button>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={option.imageUrl || "/icons/model-other.svg"} alt="" className="b-opt-thumb" />
      <label className="b-opt-upload">
        {uploading ? "Uploading…" : "Image"}
        <input type="file" accept="image/*" style={{ display: "none" }} onChange={handleUpload} />
      </label>
      <TextEditable
        className="b-opt-value"
        value={option.value}
        placeholder="value"
        onCommit={(v) => run(() => api(`/api/admin/options/${option.id}`, { method: "PATCH", body: { value: v } }))}
      />
      <TextEditable
        className="b-opt-label"
        value={option.label}
        placeholder="Label"
        onCommit={(v) => run(() => api(`/api/admin/options/${option.id}`, { method: "PATCH", body: { label: v } }))}
      />
      <TextEditable
        className="b-opt-label"
        value={option.sub}
        placeholder="Sub text (optional)"
        onCommit={(v) => run(() => api(`/api/admin/options/${option.id}`, { method: "PATCH", body: { sub: v } }))}
      />
      <NumberEditable
        className="b-opt-points"
        value={option.points}
        placeholder="pts"
        onCommit={(v) => run(() => api(`/api/admin/options/${option.id}`, { method: "PATCH", body: { points: v || 0 } }))}
      />
      <label style={{ fontSize: ".72rem", color: "var(--ink-soft)", display: "flex", alignItems: "center", gap: 4 }}>
        <input
          type="checkbox"
          checked={option.allowFreeText}
          onChange={(e) => run(() => api(`/api/admin/options/${option.id}`, { method: "PATCH", body: { allowFreeText: e.target.checked } }))}
        />
        Free text
      </label>
      <button
        className="icon-btn danger"
        title="Delete option"
        onClick={() => {
          if (confirm("Delete this option?")) run(() => api(`/api/admin/options/${option.id}`, { method: "DELETE" }));
        }}
      >
        ✕
      </button>
    </div>
  );
}
