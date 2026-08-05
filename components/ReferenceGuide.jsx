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
    paediatric: "/reference/paed-key-photo.jpg",
    paediatricLabel: "Infant/Child Key",
  },
  hs1: {
    brand: "Philips HeartStart HS1",
    serial: "/reference/hs1-serial.jpg",
    battery: "/reference/hs1-battery.jpg",
    pads: "/reference/hs1-pads.jpg",
    paediatric: "/reference/paed-key-photo.jpg",
    paediatricLabel: "Infant/Child Key",
  },
  zollPlus: {
    brand: "ZOLL AED Plus",
    serial: "/reference/zollplus-serial.jpg",
    pads: "/reference/zollplus-pads.jpg",
    paediatric: "/reference/paed-pads-zoll-photo.jpg",
    paediatricLabel: "ZOLL Pedi-padz II",
  },
  defibtech: {
    brand: "Defibtech",
    battery: "/reference/defibtech-battery.jpg",
  },
};

function modelsWithPhoto(models, kind) {
  return models.map((m) => MODEL_PHOTOS[m]).filter((m) => m && m[kind]);
}

// Full-size click-to-preview overlay, shared by every thumbnail row. Kept
// self-contained (own state, own escape/backdrop handling) so any number of
// ThumbRows can exist on a step without coordinating through a parent.
function ImageLightbox({ item, kind, labelKey, onClose }) {
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
// for it. Used both for the per-field serial/battery/pad photos and the
// paediatric photo — `labelKey` picks which field on each MODEL_PHOTOS entry
// is the caption ("brand" vs "paediatricLabel").
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

export function PaediatricReferencePhoto({ models }) {
  const items = models
    .map((m) => MODEL_PHOTOS[m])
    .filter((m) => m && m.paediatric)
    // de-dupe identical paediatric photos shared across models (FRx/HS1 both use the key)
    .filter((m, i, arr) => arr.findIndex((x) => x.paediatric === m.paediatric) === i);
  return <ThumbRow items={items} kind="paediatric" labelKey="paediatricLabel" />;
}

// Maps a question to which kind of reference photo helps it, purely from its
// label/type — works for AED (1), (2), and any (3)+ clone without needing
// per-unit special-casing.
export function referenceKindFor(question) {
  const label = (question.label || "").toLowerCase();
  if (question.type === "text" && label.includes("serial")) return "serial";
  if (question.type === "date" && label.includes("battery")) return "battery";
  if (question.type === "date" && label.includes("pad")) return "pads";
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
