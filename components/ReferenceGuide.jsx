"use client";

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

// Questions ask about a specific unit ("Battery (1) expiry date", "... (2)
// ...", a clone's "... (3) ..."), but which physical unit is which brand
// isn't tracked — the model question only captures a total count per model.
// So instead of guessing a 1:1 match, every selected model's photo is shown
// for every unit's fields; each thumbnail is labeled with its brand so it's
// never ambiguous which device it refers to.
function modelsWithPhoto(models, kind) {
  return models.map((m) => MODEL_PHOTOS[m]).filter((m) => m && m[kind]);
}

function ThumbRow({ items, kind, labelKey = "brand" }) {
  if (items.length === 0) return null;
  return (
    <div className="ref-inline">
      <span className="ref-inline-hint">Yours: </span>
      {items.map((m) => (
        <a key={m[labelKey] + m[kind]} href={m[kind]} target="_blank" rel="noreferrer" className="ref-inline-item">
          {/* eslint-disable-next-line @next/next/no-img-element -- static reference photo, not build-time content */}
          <img src={m[kind]} alt={`${m.brand} — where to find this`} loading="lazy" />
          <span>{m.brand}</span>
        </a>
      ))}
    </div>
  );
}

// Placed right under a single serial/battery/pad field — only the models the
// responder actually selected earlier, only if we have that photo for them.
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
  if (items.length === 0) return null;
  return (
    <div className="ref-inline">
      <span className="ref-inline-hint">Yours: </span>
      {items.map((m) => (
        <a key={m.paediatric} href={m.paediatric} target="_blank" rel="noreferrer" className="ref-inline-item">
          {/* eslint-disable-next-line @next/next/no-img-element -- static reference photo, not build-time content */}
          <img src={m.paediatric} alt={`${m.paediatricLabel} — reference photo`} loading="lazy" />
          <span>{m.paediatricLabel}</span>
        </a>
      ))}
    </div>
  );
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
