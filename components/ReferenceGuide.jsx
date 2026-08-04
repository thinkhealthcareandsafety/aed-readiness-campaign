"use client";

// Real photos of where to find the serial number / battery expiry / pad
// expiry on the AED brands this audit sees most — the Expiry Status
// questions are the most commonly mis-answered ones because people don't
// know where to look on the physical unit.
const AED_PHOTO_GROUPS = [
  {
    brand: "Philips HeartStart FRx",
    items: [
      { label: "Battery expiry date", src: "/reference/frx-battery.jpg" },
      { label: "Electrode pad expiry date", src: "/reference/frx-pads.jpg" },
      { label: "Serial number", src: "/reference/frx-serial.jpg" },
    ],
  },
  {
    brand: "Philips HeartStart HS1",
    items: [
      { label: "Battery expiry date", src: "/reference/hs1-battery.jpg" },
      { label: "Electrode pad expiry date", src: "/reference/hs1-pads.jpg" },
      { label: "Serial number", src: "/reference/hs1-serial.jpg" },
    ],
  },
  {
    brand: "ZOLL AED Plus",
    items: [
      { label: "Electrode pad expiry date (CPR-D-padz box)", src: "/reference/zollplus-pads.jpg" },
      { label: "Serial number", src: "/reference/zollplus-serial.jpg" },
    ],
  },
  {
    brand: "Defibtech",
    items: [{ label: "Battery expiry date", src: "/reference/defibtech-battery.jpg" }],
  },
];

const PAEDIATRIC_PHOTOS = [
  { label: "Infant/Child Key", src: "/reference/paed-key-photo.jpg" },
  { label: "ZOLL Pedi-padz II (0-8 years)", src: "/reference/paed-pads-zoll-photo.jpg" },
];

function PhotoGrid({ items }) {
  return (
    <div className="ref-grid">
      {items.map((it) => (
        <a key={it.src} href={it.src} target="_blank" rel="noreferrer" className="ref-item">
          {/* eslint-disable-next-line @next/next/no-img-element -- static reference photo, not build-optimized content */}
          <img src={it.src} alt={it.label} loading="lazy" />
          <span className="ref-item-label">{it.label}</span>
        </a>
      ))}
    </div>
  );
}

export function ExpiryReferenceGuide() {
  return (
    <details className="ref-guide">
      <summary>Not sure where to look? See labeled photos by AED brand</summary>
      <div className="ref-guide-body">
        {AED_PHOTO_GROUPS.map((g) => (
          <div key={g.brand} className="ref-group">
            <div className="ref-group-title">{g.brand}</div>
            <PhotoGrid items={g.items} />
          </div>
        ))}
      </div>
    </details>
  );
}

export function PaediatricReferenceGuide() {
  return (
    <details className="ref-guide">
      <summary>Not sure what this looks like? See reference photos</summary>
      <div className="ref-guide-body">
        <PhotoGrid items={PAEDIATRIC_PHOTOS} />
      </div>
    </details>
  );
}
