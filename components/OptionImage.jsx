"use client";

import { useState } from "react";

export function OptionImage({ src, alt }) {
  const [failed, setFailed] = useState(false);
  const effectiveSrc = !src || failed ? "/icons/model-other.svg" : src;
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
