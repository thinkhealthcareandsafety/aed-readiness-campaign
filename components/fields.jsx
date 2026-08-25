"use client";

// fieldId (a stable id, question.id at every call site) turns the visible
// label into something a bare <input>/<select> can actually be associated
// with via aria-labelledby — without it, a screen reader announces "text
// field, blank" with no indication of which of the form's ~40 fields it's
// even on. Optional so QBlock still works for the radio/checkbox/quantity
// controls below, whose own <label>-wrapped options already have an
// accessible name from their own visible text and don't need this.
export function QBlock({ label, required, points, hint, children, fieldId }) {
  return (
    <div className="qblock">
      <div className="qlabel" id={fieldId != null ? qblockLabelId(fieldId) : undefined}>
        <span>
          {label}
          {required && <span className="req">&nbsp;*</span>}
        </span>
        {points != null && <span className="pts-badge">{points} pt{points === 1 ? "" : "s"}</span>}
      </div>
      {children}
      {hint && <div className="qhint">{hint}</div>}
    </div>
  );
}

export function qblockLabelId(fieldId) {
  return `qlabel-${fieldId}`;
}

export function RadioGroup({ name, value, onChange, options, row }) {
  return (
    <div className={`options${row ? " row" : ""}`}>
      {options.map((opt) => (
        <label key={opt.value} className={`option${value === opt.value ? " selected" : ""}`}>
          <input
            type="radio"
            name={name}
            value={opt.value}
            checked={value === opt.value}
            onChange={() => onChange(opt.value)}
            // A native radio only fires onChange when its checked state
            // actually flips, which is exactly what makes it safe to detect
            // "this click didn't change anything" here: e.target.checked at
            // click time reflects the state *before* this click, so true
            // means the click landed on the already-selected option (the
            // change event won't fire for that case) — deselect. false
            // means a real selection is happening and onChange is about to
            // fire on its own; don't double up on it here.
            onClick={(e) => { if (e.target.checked) onChange(""); }}
          />
          <span>
            <span className="opt-text">{opt.label}</span>
            {opt.sub && <div className="opt-sub">{opt.sub}</div>}
          </span>
        </label>
      ))}
    </div>
  );
}

export function CheckboxList({ value, onToggle, items, disabledKeys }) {
  const v = value || {};
  const disabled = disabledKeys || new Set();
  return (
    <div className="options">
      {items.map(([key, label, sub]) => {
        const isDisabled = !v[key] && disabled.has(key);
        return (
          <label key={key} className={`option${v[key] ? " selected" : ""}${isDisabled ? " disabled" : ""}`}>
            <input type="checkbox" checked={!!v[key]} disabled={isDisabled} onChange={(e) => onToggle(key, e.target.checked)} />
            <span>
              <span className="opt-text">{label}</span>
              {sub && <div className="opt-sub">{sub}</div>}
            </span>
          </label>
        );
      })}
    </div>
  );
}

export function IconRadioGrid({ name, value, onChange, items, wide, pair }) {
  return (
    <div className={`icon-grid${wide ? " wide" : ""}${pair ? " pair" : ""}`}>
      {items.map((opt) => (
        <label key={opt.value} className={`icon-card${value === opt.value ? " selected" : ""}`}>
          <input
            type="radio"
            name={name}
            value={opt.value}
            checked={value === opt.value}
            onChange={() => onChange(opt.value)}
            // See the matching comment in RadioGroup above — same reasoning.
            onClick={(e) => { if (e.target.checked) onChange(""); }}
          />
          <span className="icon-card-check" aria-hidden="true">
            ✓
          </span>
          <span className="icon-card-art">{opt.art}</span>
          <span className="icon-card-label">{opt.label}</span>
          {opt.sub && <span className="icon-card-sub">{opt.sub}</span>}
        </label>
      ))}
    </div>
  );
}

export function IconCheckboxGrid({ value, onChange, onToggle, items, disabledKeys }) {
  const v = value || {};
  const disabled = disabledKeys || new Set();
  const handleChange = (key, checked) => {
    if (onToggle) onToggle(key, checked);
    else onChange({ ...v, [key]: checked });
  };
  return (
    <div className="icon-grid">
      {items.map(({ key, label, sub, art }) => {
        const isDisabled = !v[key] && disabled.has(key);
        return (
          <label key={key} className={`icon-card${v[key] ? " selected" : ""}${isDisabled ? " disabled" : ""}`}>
            <input
              type="checkbox"
              checked={!!v[key]}
              disabled={isDisabled}
              onChange={(e) => handleChange(key, e.target.checked)}
            />
            <span className="icon-card-check square" aria-hidden="true">
              ✓
            </span>
            <span className="icon-card-art">{art}</span>
            <span className="icon-card-label">{label}</span>
            {sub && <span className="icon-card-sub">{sub}</span>}
          </label>
        );
      })}
    </div>
  );
}

export function IconQuantityGrid({ items, value, onChange, max }) {
  const v = value || {};
  const total = Object.values(v).reduce((s, n) => s + (n || 0), 0);
  return (
    <div className="icon-grid">
      {items.map(({ key, label, sub, art }) => {
        const qty = v[key] || 0;
        const atCap = Number.isFinite(max) && total >= max && qty <= 0;
        return (
          <div key={key} className={`icon-card${qty > 0 ? " selected" : ""}${atCap ? " disabled" : ""}`}>
            <span className="icon-card-art">{art}</span>
            <span className="icon-card-label">{label}</span>
            {sub && <span className="icon-card-sub">{sub}</span>}
            <div className="qty-stepper">
              <button type="button" className="icon-btn" disabled={qty <= 0} onClick={() => onChange(key, qty - 1)}>
                −
              </button>
              <span className="qty-value tabular">{qty}</span>
              <button
                type="button"
                className="icon-btn"
                disabled={Number.isFinite(max) && total >= max}
                onClick={() => onChange(key, qty + 1)}
              >
                +
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function TextInput({ type = "text", value, onChange, placeholder, ariaLabelledby }) {
  return (
    <input
      type={type}
      value={value || ""}
      placeholder={placeholder}
      aria-labelledby={ariaLabelledby}
      // Real format enforcement lives server-side (lib/genericScoring.js
      // isValidEmail/isValidIndianMobile) — these are just the matching
      // mobile-keyboard/length hints so a phone field doesn't invite a
      // 20-character paste in the first place.
      inputMode={type === "tel" ? "tel" : undefined}
      maxLength={type === "tel" ? 10 : undefined}
      autoComplete={type === "email" ? "email" : type === "tel" ? "tel" : undefined}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

// A short, fixed list of options (5-6 or fewer) reads faster as a row of
// tappable tabs than as a native dropdown a respondent has to open, scan,
// then close — one extra interaction for something that could've been
// scannable at a glance. Kept separate from Select (used for longer lists
// like the 10-option AED count, where tabs would wrap awkwardly) rather
// than replacing it outright.
export function TabSelect({ value, onChange, options }) {
  return (
    <div className="tab-select" role="radiogroup">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          className={`tab-select-btn${value === o.value ? " selected" : ""}`}
          // Same deselect-on-reclick behavior as every other single-choice
          // control on this form (see setRadioAnswer in AuditWizard.jsx) —
          // a plain button doesn't have the native-radio "checked state
          // must change" restriction, so this needs no separate onClick.
          onClick={() => onChange(value === o.value ? "" : o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Select({ value, onChange, options, placeholder, ariaLabelledby }) {
  return (
    <select value={value || ""} onChange={(e) => onChange(e.target.value)} aria-labelledby={ariaLabelledby}>
      <option value="" disabled>
        {placeholder || "Select..."}
      </option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function LinearScale({ value, onChange, min = 1, max = 5, minLabel, maxLabel }) {
  const nums = [];
  for (let i = min; i <= max; i++) nums.push(i);
  return (
    <div className="scale">
      <span className="end">{minLabel}</span>
      <div className="dots">
        {nums.map((n) => (
          <label key={n} className={value === n ? "selected" : undefined}>
            <input
              type="radio"
              checked={value === n}
              onChange={() => onChange(n)}
              // See the matching comment on RadioGroup in this same file —
              // e.target.checked at click time reflects state *before* this
              // click, so true means re-clicking the already-selected dot.
              onClick={(e) => { if (e.target.checked) onChange(null); }}
            />
            <span>{n}</span>
          </label>
        ))}
      </div>
      <span className="end right">{maxLabel}</span>
    </div>
  );
}
