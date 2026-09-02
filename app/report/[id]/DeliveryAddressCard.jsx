"use client";

import { useState } from "react";
import { COUNTRY_CODES } from "@/lib/phoneCountries";
import { INDIA_STATES } from "@/lib/indiaStates";
import { listDeliveryCities } from "@/lib/hotelCities";

const EMPTY_FORM = { name: "", address1: "", address2: "", city: "", state: "", postalCode: "", country: "India", notes: "" };
const REQUIRED_FIELDS = ["name", "address1", "city", "state", "postalCode", "country"];
const COUNTRY_NAMES = COUNTRY_CODES.map((c) => c.name);
const DELIVERY_CITIES = listDeliveryCities();

// A plain <select> can't offer every city/state/country on earth, so each
// of these pairs a curated dropdown with a manual fallback — picking
// "Other" (or loading with a value the list doesn't contain, e.g. a
// pre-existing free-typed entry) reveals a text input instead of silently
// discarding or mis-selecting it.
function DropdownField({ id, value, onChange, options, otherPlaceholder, required }) {
  const [otherMode, setOtherMode] = useState(() => !!value && !options.includes(value));
  const selectValue = otherMode ? "__other__" : value;

  return (
    <>
      <select
        id={id}
        value={selectValue}
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

  function setField(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const missing = REQUIRED_FIELDS.filter((f) => !form[f].trim());
    if (missing.length > 0) {
      setError("Please fill in every required field before saving.");
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
              <label className="delivery-field span-2">
                Full name*
                <input type="text" value={form.name} onChange={(e) => setField("name", e.target.value)} required />
              </label>
              <label className="delivery-field span-2">
                Address line 1*
                <input type="text" value={form.address1} onChange={(e) => setField("address1", e.target.value)} required />
              </label>
              <label className="delivery-field span-2">
                Address line 2 (optional)
                <input type="text" value={form.address2} onChange={(e) => setField("address2", e.target.value)} />
              </label>
              <label className="delivery-field">
                City*
                <DropdownField
                  value={form.city}
                  onChange={(v) => setField("city", v)}
                  options={DELIVERY_CITIES}
                  otherPlaceholder="Enter your city"
                  required
                />
              </label>
              <label className="delivery-field">
                State / Province*
                {form.country === "India" ? (
                  <DropdownField
                    value={form.state}
                    onChange={(v) => setField("state", v)}
                    options={INDIA_STATES}
                    otherPlaceholder="Enter your state"
                    required
                  />
                ) : (
                  <input type="text" value={form.state} onChange={(e) => setField("state", e.target.value)} required />
                )}
              </label>
              <label className="delivery-field">
                Postal code*
                <input type="text" value={form.postalCode} onChange={(e) => setField("postalCode", e.target.value)} required />
              </label>
              <label className="delivery-field">
                Country*
                <DropdownField
                  value={form.country}
                  onChange={(v) => setField("country", v)}
                  options={COUNTRY_NAMES}
                  otherPlaceholder="Enter your country"
                  required
                />
              </label>
              <label className="delivery-field span-2">
                Delivery instructions (optional)
                <textarea rows={2} value={form.notes} onChange={(e) => setField("notes", e.target.value)} />
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
