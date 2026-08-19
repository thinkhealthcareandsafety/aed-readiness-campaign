"use client";

export function QBlock({ label, required, points, hint, children }) {
  return (
    <div className="qblock">
      <div className="qlabel">
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

export function TextInput({ type = "text", value, onChange, placeholder }) {
  return (
    <input
      type={type}
      value={value || ""}
      placeholder={placeholder}
      // Real format enforcement lives server-side (lib/genericScoring.js
      // isValidEmail/isValidIndianMobile) — these are just the matching
      // mobile-keyboard/length hints so a phone field doesn't invite a
      // 20-character paste in the first place.
      inputMode={type === "tel" ? "tel" : undefined}
      maxLength={type === "tel" ? 15 : undefined}
      autoComplete={type === "email" ? "email" : type === "tel" ? "tel" : undefined}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export function Select({ value, onChange, options, placeholder }) {
  return (
    <select value={value || ""} onChange={(e) => onChange(e.target.value)}>
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
            <input type="radio" checked={value === n} onChange={() => onChange(n)} />
            <span>{n}</span>
          </label>
        ))}
      </div>
      <span className="end right">{maxLabel}</span>
    </div>
  );
}
