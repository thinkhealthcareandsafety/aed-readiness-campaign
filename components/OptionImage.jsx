"use client";

import { useState } from "react";

// Shared with AuditWizard.jsx (decides whether an option's image is worth a
// tap-to-zoom affordance — never useful for a small flat SVG pictogram).
export function isPhotoUrl(src) {
  return /\.(jpe?g|png|webp)(\?|$)/i.test(src || "");
}

export function OptionImage({ src, alt }) {
  const [failed, setFailed] = useState(false);
  const effectiveSrc = !src || failed ? "/icons/model-other.svg" : src;
  // Real photos (.jpg/.png/.webp) should fill their card edge-to-edge —
  // cropping via object-fit:cover reads as a proper product photo, not a
  // thumbnail floating in whitespace. Flat SVG pictograms (still used for
  // several questions that never got a real photo) are drawn to be seen in
  // full, not cropped, so those keep the old contain/max-size behavior.
  const isPhoto = isPhotoUrl(effectiveSrc);
  return (
    // eslint-disable-next-line @next/next/no-img-element -- images are admin-uploaded, not build-time known assets
    <img
      src={effectiveSrc}
      alt={alt || ""}
      onError={() => setFailed(true)}
      style={
        isPhoto
          ? { width: "100%", height: "100%", objectFit: "cover" }
          : { maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }
      }
    />
  );
}
