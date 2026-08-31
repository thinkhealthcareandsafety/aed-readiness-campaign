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
  // object-fit:cover here used to crop real photos edge-to-edge — fine for
  // a photo already framed close to the card's own aspect ratio, but the
  // card grids span several different widths (a 4-up model grid, a 2-up
  // Yes/No pair, ...) while the source photos are various-shaped product
  // shots, so "cover" was cropping several of them down to an unrecognizable
  // sliver (e.g. the ZOLL AED Plus photo losing its logo and handle, only a
  // thin strip through the middle surviving). object-fit:contain shows the
  // whole photo at every card size instead, same as the flat SVG
  // pictograms already did — never upscaled past its own resolution, never
  // cropped.
  return (
    // eslint-disable-next-line @next/next/no-img-element -- images are admin-uploaded, not build-time known assets
    <img
      src={effectiveSrc}
      alt={alt || ""}
      onError={() => setFailed(true)}
      style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
    />
  );
}
