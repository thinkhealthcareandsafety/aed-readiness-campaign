"use client";

import { useState } from "react";
import { COUNTRY_CODES } from "@/lib/phoneCountries";
import { INDIA_STATES } from "@/lib/indiaStates";
import { listDeliveryCities } from "@/lib/hotelCities";
import { isValidPersonName } from "@/lib/genericScoring";

const EMPTY_FORM = { name: "", address1: "", address2: "", city: "", state: "", postalCode: "", country: "India", notes: "" };
const REQUIRED_FIELDS = ["name", "address1", "city", "state", "postalCode", "country"];
const COUNTRY_NAMES = COUNTRY_CODES.map((c) => c.name);
const DELIVERY_CITIES = listDeliveryCities();
const INDIA_POSTAL_RE = /^[1-9][0-9]{5}$/;

// Field-level checks beyond "is it non-empty" — the same trust boundary
// AuditWizard's own text fields already enforce (see isValidPersonName in
// genericScoring.js), applied here too since this form previously accepted
// literally anything ("ttt4" as an address, a PIN of "4t4t") with no
// feedback beyond a single generic "fill in every field" message.
function fieldError(field, value, country) {
  const trimmed = String(value || "").trim();
  if (REQUIRED_FIELDS.includes(field) && !trimmed) return "Required";
  if (field === "name" && trimmed && !isValidPersonName(trimmed)) return "Enter a valid name (letters only)";
  if (field === "postalCode" && trimmed && country === "India" && !INDIA_POSTAL_RE.test(trimmed)) {
    return "Enter a valid 6-digit PIN code";
  }
  return "";
}

// A plain <select> can't offer every city/state/country on earth, so each
// of these pairs a curated dropdown with a manual fallback — picking
// "Other" (or loading with a value the list doesn't contain, e.g. a
// pre-existing free-typed entry) reveals a text input instead of silently
// discarding or mis-selecting it.
function DropdownField({ id, value, onChange, options, otherPlaceholder, autoComplete, required }) {
  const [otherMode, setOtherMode] = useState(() => !!value && !options.includes(value));
  const selectValue = otherMode ? "__other__" : value;

  return (
    <>
      <select
        id={id}
        value={selectValue}
        autoComplete={otherMode ? "off" : autoComplete}
        onChange={(e) => {
          if (e.target.value === "__other__") {
            setOtherMode(true);
          } else {
            setOtherMode(false);
            onChange(e.target.value);
          }
        }}
        required={required}
      >
        <option value="" disabled>
          Select…
        </option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
        <option value="__other__">Other (type manually)</option>
      </select>
      {otherMode && (
        <input
          type="text"
          autoComplete={autoComplete}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={otherPlaceholder}
          required={required}
          style={{ marginTop: 6 }}
        />
      )}
    </>
  );
}

// Shown on the report only for a prize that actually needs shipping (see
// prizeRequiresDelivery in lib/prizes.js — the AEDSmartX subscription has
// nothing to deliver, so this never renders for it). Starts in "saved"
// mode if the winner already submitted an address on a previous visit to
// this same report link, otherwise opens straight into the form — either
// way the goal is the same one-time prompt, not a second form to fill out
// during the audit itself.
export default function DeliveryAddressCard({ submissionId, wonPrizeLabel, initialSaved, initialAddress, initialName }) {
  const [saved, setSaved] = useState(initialSaved);
  const [editing, setEditing] = useState(!initialSaved);
  const [form, setForm] = useState(() => ({
    ...EMPTY_FORM,
    ...(initialAddress || {}),
    name: (initialAddress && initialAddress.name) || initialName || "",
  }));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [touched, setTouched] = useState({});

  function setField(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
    const country = field === "country" ? value : form.country;
    setFieldErrors((fe) => {
      const next = { ...fe };
      if (touched[field]) next[field] = fieldError(field, value, country);
      // Postal-code validity depends on country, so switching country
      // re-checks an already-touched postal code even though its own
      // value didn't change.
      if (field === "country" && touched.postalCode) next.postalCode = fieldError("postalCode", form.postalCode, country);
      return next;
    });
  }

  function blurField(field) {
    setTouched((t) => ({ ...t, [field]: true }));
    setFieldErrors((fe) => ({ ...fe, [field]: fieldError(field, form[field], form.country) }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const nextErrors = {};
    for (const f of Object.keys(EMPTY_FORM)) {
      const msg = fieldError(f, form[f], form.country);
      if (msg) nextErrors[f] = msg;
    }
    if (Object.keys(nextErrors).length > 0) {
      setFieldErrors(nextErrors);
      setTouched(Object.fromEntries(Object.keys(EMPTY_FORM).map((f) => [f, true])));
      setError("Please fix the highlighted fields before saving.");
      return;
    }
    setError("");
    setSubmitting(true);
    try {
      const res = await fetch(`/api/submissions/${submissionId}/delivery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Could not save your delivery details. Please try again.");
      }
      setSaved(true);
      setEditing(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="prize-callout-card delivery-card no-print">
      <div className="prize-icon">🎁</div>
      <div className="prize-info" style={{ flex: 1 }}>
        <h4>Prize Unlocked: {wonPrizeLabel}</h4>

        {saved && !editing ? (
          <>
            <p>Delivery details received — our fulfillment team will ship your prize to the address below.</p>
            <div className="delivery-saved-summary">
              <div className="info-row">
                <span className="info-key">Name</span>
                <span className="info-val">{form.name}</span>
              </div>
              <div className="info-row">
                <span className="info-key">Address</span>
                <span className="info-val">
                  {form.address1}
                  {form.address2 ? `, ${form.address2}` : ""}, {form.city}, {form.state} {form.postalCode}, {form.country}
                </span>
              </div>
              {form.notes && (
                <div className="info-row">
                  <span className="info-key">Delivery notes</span>
                  <span className="info-val">{form.notes}</span>
                </div>
              )}
            </div>
            <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 10 }} onClick={() => setEditing(true)}>
              Edit delivery details
            </button>
          </>
        ) : (
          <>
            <p>Tell us where to send it — one-time details so we can ship your prize.</p>
            <form className="delivery-form-grid" onSubmit={handleSubmit}>
              <label className={`delivery-field span-2${fieldErrors.name ? " has-error" : ""}`}>
                Full name*
                <input
                  type="text"
                  autoComplete="name"
                  value={form.name}
                  onChange={(e) => setField("name", e.target.value)}
                  onBlur={() => blurField("name")}
                  required
                />
                {fieldErrors.name && <span className="delivery-field-error">{fieldErrors.name}</span>}
              </label>
              <label className={`delivery-field span-2${fieldErrors.address1 ? " has-error" : ""}`}>
                Address line 1*
                <input
                  type="text"
                  autoComplete="address-line1"
                  value={form.address1}
                  onChange={(e) => setField("address1", e.target.value)}
                  onBlur={() => blurField("address1")}
                  required
                />
                {fieldErrors.address1 && <span className="delivery-field-error">{fieldErrors.address1}</span>}
              </label>
              <label className="delivery-field span-2">
                Address line 2 (optional)
                <input
                  type="text"
                  autoComplete="address-line2"
                  value={form.address2}
                  onChange={(e) => setField("address2", e.target.value)}
                />
              </label>
              <label className={`delivery-field${fieldErrors.city ? " has-error" : ""}`}>
                City*
                <DropdownField
                  id="delivery-city"
                  value={form.city}
                  onChange={(v) => {
                    setField("city", v);
                    blurField("city");
                  }}
                  options={DELIVERY_CITIES}
                  otherPlaceholder="Enter your city"
                  autoComplete="address-level2"
                  required
                />
                {fieldErrors.city && <span className="delivery-field-error">{fieldErrors.city}</span>}
              </label>
              <label className={`delivery-field${fieldErrors.state ? " has-error" : ""}`}>
                State / Province*
                {form.country === "India" ? (
                  <DropdownField
                    id="delivery-state"
                    value={form.state}
                    onChange={(v) => {
                      setField("state", v);
                      blurField("state");
                    }}
                    options={INDIA_STATES}
                    otherPlaceholder="Enter your state"
                    autoComplete="address-level1"
                    required
                  />
                ) : (
                  <input
                    type="text"
                    autoComplete="address-level1"
                    value={form.state}
                    onChange={(e) => setField("state", e.target.value)}
                    onBlur={() => blurField("state")}
                    required
                  />
                )}
                {fieldErrors.state && <span className="delivery-field-error">{fieldErrors.state}</span>}
              </label>
              <label className={`delivery-field${fieldErrors.postalCode ? " has-error" : ""}`}>
                Postal code*
                <input
                  type="text"
                  autoComplete="postal-code"
                  inputMode={form.country === "India" ? "numeric" : "text"}
                  maxLength={form.country === "India" ? 6 : 12}
                  placeholder={form.country === "India" ? "6-digit PIN code" : ""}
                  value={form.postalCode}
                  onChange={(e) => setField("postalCode", e.target.value)}
                  onBlur={() => blurField("postalCode")}
                  required
                />
                {fieldErrors.postalCode && <span className="delivery-field-error">{fieldErrors.postalCode}</span>}
              </label>
              <label className={`delivery-field${fieldErrors.country ? " has-error" : ""}`}>
                Country*
                <DropdownField
                  id="delivery-country"
                  value={form.country}
                  onChange={(v) => {
                    setField("country", v);
                    blurField("country");
                  }}
                  options={COUNTRY_NAMES}
                  otherPlaceholder="Enter your country"
                  autoComplete="country-name"
                  required
                />
              </label>
              <label className="delivery-field span-2">
                Delivery instructions (optional)
                <textarea rows={2} maxLength={300} value={form.notes} onChange={(e) => setField("notes", e.target.value)} />
              </label>

              {error && (
                <div className="delivery-form-error span-2" role="alert">
                  {error}
                </div>
              )}

              <div className="span-2" style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <button type="submit" className="btn btn-primary btn-sm" disabled={submitting}>
                  {submitting ? "Saving..." : "Save delivery details"}
                </button>
                {saved && (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>
                    Cancel
                  </button>
                )}
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
