"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

// Real photos of where to find the serial number / battery expiry / pad
// expiry on the AED brands we have reference shots for. Keyed by the same
// model `value`s used in the AED model quantity question (frx, hs1,
// zollPlus, defibtech, …) so a selected model maps straight to its photos.
const MODEL_PHOTOS = {
  frx: {
    brand: "Philips HeartStart FRx",
    serial: "/reference/frx-serial.jpg",
    battery: "/reference/frx-battery.jpg",
    pads: "/reference/frx-pads.jpg",
    // Distinct from `battery`/`pads` above — those two are annotated shots
    // for finding the *expiry date* specifically; these are plain shots of
    // the compartment/connector for the separate "is it actually seated"
    // physical-status questions, which ask something different.
    batteryAttached: "/reference/frx-battery-attached.jpg",
    padsAttached: "/reference/frx-pads-connected.jpg",
    // Real photo of a genuinely cracked FRx front panel — see the
    // `damage` kind resolution in AuditWizard.jsx, which always prefers
    // the reporting unit's own model photo here instead of one shared
    // cross-brand composite (damage-examples.jpg, still the fallback for
    // any model without one of its own).
    damage: "/reference/frx-damage.jpg",
  },
  hs1: {
    brand: "Philips HeartStart HS1",
    serial: "/reference/hs1-serial.jpg",
    battery: "/reference/hs1-battery.jpg",
    pads: "/reference/hs1-pads.jpg",
    batteryAttached: "/reference/hs1-battery-attached.jpg",
    padsAttached: "/reference/hs1-pads-connected.jpg",
    // Real photos of the same empty battery bay / cartridge slot on an HS1
    // unit — closes the same "No" gap already fixed for ZOLL AED Plus (see
    // AuditWizard.jsx's NOT_ATTACHED_KIND resolution).
    batteryNotAttached: "/reference/hs1-battery-not-attached.jpg",
    padsNotAttached: "/reference/hs1-pads-not-attached.jpg",
    damage: "/reference/hs1-damage.jpg",
  },
  zollPlus: {
    brand: "ZOLL AED Plus",
    serial: "/reference/zollplus-serial.jpg",
    pads: "/reference/zollplus-pads.jpg",
    // Real photo from ZOLL's own AED Plus Administrator's Guide (Figure 8:
    // Battery Compartment) — the AED Plus takes 10 loose lithium cells in a
    // battery bank rather than a single labeled pack, so there's no single
    // "expiry sticker" shot the way the Philips units have; this shows the
    // actual compartment/cell layout instead.
    battery: "/reference/zollplus-battery.jpg",
    // Real photos of this exact unit (same lime-green AED Plus as
    // zollplus-serial/pads above) showing both the pass and fail state for
    // each question — supersedes an earlier round that reused one official
    // manual diagram for all four, which worked as a "where is this part"
    // reference but wasn't the real photo-of-the-actual-state each Yes/No
    // button is supposed to show.
    batteryAttached: "/reference/zollplus-battery-attached.jpg",
    batteryNotAttached: "/reference/zollplus-battery-not-attached.jpg",
    padsAttached: "/reference/zollplus-pads-attached.jpg",
    padsNotAttached: "/reference/zollplus-pads-not-attached.jpg",
    damage: "/reference/zollplus-damage.jpg",
  },
  defibtech: {
    brand: "Defibtech",
    battery: "/reference/defibtech-battery.jpg",
    // Sourced from Defibtech's own DDU-100 User Manual (the exact
    // sub-model matching this app's existing defibtech.jpg selector
    // thumbnail — Defibtech has several visually different sub-models, so
    // this specific match mattered) rather than a stock photo, for the
    // same reason as zollPlus above: an official diagram is unambiguous
    // about which exact part is which, and only one page reused for both.
    pads: "/reference/defibtech-pads.jpg",
    batteryAttached: "/reference/defibtech-unit-diagram.jpg",
    padsAttached: "/reference/defibtech-unit-diagram.jpg",
  },
};

function modelsWithPhoto(models, kind) {
  return models.map((m) => MODEL_PHOTOS[m]).filter((m) => m && m[kind]);
}

// Exposes one specific model's photo without handing callers the whole
// MODEL_PHOTOS table — used by AuditWizard.jsx to swap the actual Yes/No
// answer-button artwork on the battery/pads "installed correctly?"
// questions to match whichever model that specific unit reported, instead
// of every unit showing the same seeded Philips FRx photo regardless of
// its real model.
export function photoForModel(model, kind) {
  return (model && MODEL_PHOTOS[model]?.[kind]) || null;
}

// Full-size click-to-preview overlay, shared by every thumbnail row. Kept
// self-contained (own state, own escape/backdrop handling) so any number of
// ThumbRows can exist on a step without coordinating through a parent.
// Exported for reuse by the icon-card option grids in AuditWizard.jsx —
// tapping an option's own photo (battery-attached, cabinet, etc.) opens the
// exact same zoomed preview as the field-level reference photos, so this is
// one shared lightbox implementation rather than two.
export function ImageLightbox({ item, kind, labelKey, onClose }) {
  useEffect(() => {
    if (!item) return;
    function onKeyDown(e) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [item, onClose]);

  if (!item) return null;
  const caption = item[labelKey];

  // Portaled straight onto <body> rather than rendered in place: a `fixed`
  // element positions itself relative to any ancestor that has a `transform`
  // (even one only declared inside a keyframe animation, like the wizard
  // card's step-change fade) instead of the viewport. Nested in the form,
  // that pinned the modal to the animating card's box and let it land
  // off-screen on longer steps — the portal sidesteps that entirely.
  return createPortal(
    <div className="ref-lightbox-backdrop" onClick={onClose} role="presentation">
      <div
        className="ref-lightbox"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`${caption} reference photo`}
      >
        <button type="button" className="ref-lightbox-close" onClick={onClose} aria-label="Close preview">
          &times;
        </button>
        {/* eslint-disable-next-line @next/next/no-img-element -- static reference photo, not build-time content */}
        <img src={item[kind]} alt={`${caption} — where to find this`} />
        <div className="ref-lightbox-caption">{caption}</div>
      </div>
    </div>,
    document.body
  );
}

// Renders the small "Yours:" pill row and owns the click-to-preview state
// for it. `labelKey` picks which field on each item is the caption ("brand"
// for the per-field serial/battery/pad photos, "caption" for the generic
// cabinet/readiness examples).
function ThumbRow({ items, kind, labelKey = "brand" }) {
  const [preview, setPreview] = useState(null);
  if (items.length === 0) return null;
  return (
    <div className="ref-inline">
      <span className="ref-inline-hint">Your reference photo</span>
      <div className="ref-inline-list">
        {items.map((m) => (
          <button
            key={m[labelKey] + m[kind]}
            type="button"
            className="ref-inline-item"
            onClick={() => setPreview(m)}
          >
            <span className="ref-inline-thumb">
              {/* eslint-disable-next-line @next/next/no-img-element -- static reference photo, not build-time content */}
              <img src={m[kind]} alt={`${m[labelKey]} — where to find this`} loading="lazy" />
              <span className="ref-inline-zoom" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <circle cx="10.5" cy="10.5" r="6.5" />
                  <path d="M20 20l-4.7-4.7" />
                </svg>
              </span>
            </span>
            <span className="ref-inline-label">{m[labelKey]}</span>
          </button>
        ))}
      </div>
      <ImageLightbox item={preview} kind={kind} labelKey={labelKey} onClose={() => setPreview(null)} />
    </div>
  );
}

// Placed right under a single serial/battery/pad field. `models` should
// normally be a single-item array — the one physical unit this field is
// asking about (resolved sequentially from the AED model quantities, see
// resolveUnitModel in AuditWizard.jsx) — so the badge shown always matches
// the brand of *this* AED, not every brand the responder owns. Falls back to
// showing every selected model when the field isn't tied to a specific unit,
// or when the unit can't be resolved (e.g. answers not fully filled in yet).
export function FieldReferencePhoto({ models, kind }) {
  const items = modelsWithPhoto(models, kind);
  return <ThumbRow items={items} kind={kind} />;
}

// A cabinet mount isn't part of the AED unit itself — it's property-specific
// hardware, not a brand feature — so unlike every other reference photo here
// it isn't keyed per-model. One generic "what a good installation looks
// like" example, honestly captioned as an example rather than any specific
// brand's cabinet.
const CABINET_PHOTO = { caption: "Example: mounted, visible AED cabinet", photo: "/reference/aed-cabinet-example.jpg" };
export function CabinetReferencePhoto() {
  return <ThumbRow items={[CABINET_PHOTO]} kind="photo" labelKey="caption" />;
}

// Same reasoning as CabinetReferencePhoto: the status-light *pattern* (solid
// or slow-blinking green = ready) is the same thing to look for across
// brands, but the only real photo on hand is the Philips FRx panel — so
// this is captioned as a worked example, not asserted to be this unit's
// own brand.
const READY_INDICATOR_PHOTO = { caption: "Example: green (ready) indicator", photo: "/reference/frx-status-ready.jpg" };
export function ReadinessReferencePhoto() {
  return <ThumbRow items={[READY_INDICATOR_PHOTO]} kind="photo" labelKey="caption" />;
}

// Maps a question to which kind of reference photo helps it, purely from its
// label/type — works for AED (1), (2), and any (3)+ clone without needing
// per-unit special-casing.
export function referenceKindFor(question) {
  const label = (question.label || "").toLowerCase();
  if (question.type === "text" && label.includes("serial")) return "serial";
  if (question.type === "date" && label.includes("battery")) return "battery";
  if (question.type === "date" && label.includes("pad")) return "pads";
  // Word-presence checks, not exact-phrase substring matches — per-unit
  // labels now insert "(1)"/"(2)" between the words ("battery (1) installed
  // correctly?"), which would break a literal "battery installed" substring
  // check.
  if (question.type === "radio" && label.includes("battery") && label.includes("installed")) return "batteryAttached";
  if (question.type === "radio" && label.includes("pads") && label.includes("connected")) return "padsAttached";
  if (question.type === "radio" && label.includes("damage")) return "damage";
  return null;
}

// Pulls the unit number out of a question label like "Enter the serial
// number of AED (1)" or "Expiry date of Electrode pads (2)" → 1 / 2. Used to
// look up that unit's model in the sequence produced by
// getAedModelSequence(), so each AED's fields show only that AED's photos.
export function unitNumberFromLabel(label) {
  const m = /\((\d+)\)/.exec(label || "");
  return m ? parseInt(m[1], 10) : null;
}
