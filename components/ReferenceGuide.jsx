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
    batteryAttached: "/reference/frx-battery-attached.jpg",
    batteryNotAttached: "/reference/frx-battery-not-attached.jpg",
    padsAttached: "/reference/frx-pads-connected.jpg",
    padsNotAttached: "/reference/frx-pads-not-connected.jpg",
    readyIndicator: "/reference/frx-status-ready.jpg",
    notReadyIndicator: "/reference/frx-status-notready.jpg",
    damage: "/reference/frx-damage.jpg",
    child: "/reference/frx-child-key.jpg",
    tips: {
      child: "Infant/child key: a blue key with a pink ring",
    },
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
    // Real photos of this exact unit's power button — lit green (ready)
    // and dark/unlit (not ready).
    readyIndicator: "/reference/hs1-ready.jpg",
    notReadyIndicator: "/reference/hs1-notready.jpg",
    // Drawn from Philips' own description of the cartridge — no clean photo
    // of one exists — so the tip says it's a drawing.
    child: "/reference/hs1-child-pads.jpg",
    tips: {
      child: "Infant/child pads cartridge: look for the teddy bear (drawing)",
    },
  },
  zollPlus: {
    brand: "ZOLL AED Plus",
    serial: "/reference/zollplus-serial.jpg",
    pads: "/reference/zollplus-pads.jpg",
    // The AED Plus takes 10 loose cells, so the date isn't on the battery:
    // per ZOLL's battery-label instructions it's written on a "Replace
    // batteries on or before" label stuck just below the status window.
    // A drawing of that label (no clean photo of one exists) — it answers
    // "where is the date" where the old cell-compartment photo
    // (zollplus-battery.jpg) showed no date at all.
    battery: "/reference/zollplus-battery-label.jpg",
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
    // Real photos of this same unit's status/self-test button — lit (ring
    // glowing) for the "displaying a ready indicator" Yes answer, dark/idle
    // for the "Red / Orange / Not ready" one. Supersedes the seeded
    // Philips-specific frx-status-ready/notready photos for any unit
    // reported as a ZOLL AED Plus.
    readyIndicator: "/reference/zollplus-ready.jpg",
    notReadyIndicator: "/reference/zollplus-notready.jpg",
    child: "/reference/zollplus-child-pads.jpg",
    tips: {
      battery: "“Replace batteries on or before” label, just below the status window (drawing)",
      child: "Pedi-padz II: a separate pack of child pads (drawing)",
    },
  },
  // The orange Powerheart G5 in the model picker (Cardiac Science, now
  // ZOLL). Photos of real units from the AED inspection platform's library,
  // except the two "not" states, which no real photo was found for:
  // g5-pads-not-connected is a generated picture drawn from real photos of
  // the unit, and g5-notready is the real front shot with its Rescue Ready
  // light turned red — the colour ZOLL documents for "needs attention".
  g5: {
    brand: "Cardiac Science Powerheart G5",
    serial: "/reference/g5-serial.jpg",
    battery: "/reference/g5-battery.jpg",
    pads: "/reference/g5-pads.jpg",
    batteryAttached: "/reference/g5-battery-attached.jpg",
    batteryNotAttached: "/reference/g5-battery-not-attached.jpg",
    padsAttached: "/reference/g5-pads-connected.jpg",
    padsNotAttached: "/reference/g5-pads-not-connected.jpg",
    readyIndicator: "/reference/g5-ready.jpg",
    notReadyIndicator: "/reference/g5-notready.jpg",
    goodCondition: "/reference/g5-front.jpg",
    child: "/reference/g5-child-pads.jpg",
    tips: {
      serial: "The number beside “SN” on the label on the back",
      // The G5's battery carries its manufacture date, not an expiry date.
      battery: "The date by the factory symbol is when it was made: it lasts 4 years from fitting",
      pads: "The pads' date shows in the window on the lid",
      readyIndicator: "Rescue Ready light by the handle: green is ready, red needs attention",
      child: "Child pads pack, kept beside the AED",
    },
  },
  // The yellow Lifeline (DDU-100) in the model picker. Real photos of the
  // unit and its packs replace the manual's line drawings, which showed
  // where parts are but never the date itself. defibtech-battery-attached
  // and defibtech-pads-not-connected are generated pictures drawn from real
  // photos of the unit — no real photo of either state was found.
  defibtech: {
    brand: "Defibtech Lifeline",
    serial: "/reference/defibtech-serial.jpg",
    battery: "/reference/defibtech-battery.jpg",
    pads: "/reference/defibtech-pads-label.jpg",
    batteryAttached: "/reference/defibtech-battery-attached.jpg",
    batteryNotAttached: "/reference/defibtech-battery-not-attached.jpg",
    padsAttached: "/reference/defibtech-pads-connected.jpg",
    padsNotAttached: "/reference/defibtech-pads-not-connected.jpg",
    readyIndicator: "/reference/defibtech-ready.jpg",
    goodCondition: "/reference/defibtech-front.jpg",
    child: "/reference/defibtech-child-pads.jpg",
    tips: {
      serial: "Slide the pads pack out of the back: the serial label is behind it",
      battery: "The date beside the ⌛ on the battery label",
      pads: "The date beside the ⌛ on the pads pack's white label",
      readyIndicator: "The small light at the top right corner: it flashes green when ready",
      child: "Child pads pack (DDP-200P): light blue",
    },
  },
};

function modelsWithPhoto(models, kind) {
  return models.map((m) => MODEL_PHOTOS[m]).filter((m) => m && m[kind]);
}

// A short "where exactly to look" line for one model's photo, where the
// photo alone isn't enough (a label hidden behind the pads pack, a battery
// that carries its made-on date instead of an expiry date).
function tipFor(item, kind) {
  return item?.tips?.[kind] || null;
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
  const tip = item.tip;

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
        <img src={item[kind] || item.photo || item.src || item.imageUrl} alt={`${caption} — reference photo`} />
        {caption && <div className="ref-lightbox-caption">{caption}</div>}
        {tip && <div className="ref-lightbox-tip">{tip}</div>}
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
        {items.map((m) => {
          const tip = m.tip || tipFor(m, kind);
          return (
            <button
              key={m[labelKey] + m[kind]}
              type="button"
              className="ref-inline-item"
              onClick={() => setPreview({ ...m, tip })}
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
              {tip ? (
                <span className="ref-inline-meta">
                  <span className="ref-inline-model">{m[labelKey]}</span>
                  <span className="ref-inline-part">{tip}</span>
                </span>
              ) : (
                <span className="ref-inline-label">{m[labelKey]}</span>
              )}
            </button>
          );
        })}
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

// The status light sits somewhere different on every brand (a dot by the
// handle on a Lifeline, a big ring on a G5), so the unit's own photo is shown
// when there is one. Only a model with no photo of its own falls back to the
// Philips FRx panel, captioned as a worked example rather than as this unit.
const READY_INDICATOR_PHOTO = { caption: "Example: green (ready) indicator", photo: "/reference/frx-status-ready.jpg" };
export function ReadinessReferencePhoto({ model }) {
  if (model && MODEL_PHOTOS[model]?.readyIndicator) {
    return <FieldReferencePhoto models={[model]} kind="readyIndicator" />;
  }
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
  if (question.type === "radio" && label.includes("ready") && label.includes("indicator")) return "readyIndicator";
  // "Is there a Paediatric Pad or Infant/Child Key for AED (1)?" — each
  // brand provides for children differently (a key, a cartridge, a pack),
  // so the unit's own child provision is shown under the answer cards.
  if (question.type === "radio" && (label.includes("paediatric") || label.includes("child key"))) return "child";
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
