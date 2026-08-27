"use client";

import { useEffect, useState } from "react";
import { PRIZES } from "@/lib/prizes";

const SLICE_DEG = 360 / PRIZES.length; // 72°
const SPIN_MS = 5000;
const SPIN_TURNS = 6;

function sliceMidDeg(index) {
  return index * SLICE_DEG - 90 + SLICE_DEG / 2; // -90 so slice 0 starts at 12 o'clock
}

function slicePath(index) {
  const startDeg = index * SLICE_DEG - 90;
  const endDeg = startDeg + SLICE_DEG;
  const cx = 100;
  const cy = 100;
  const r = 88;
  const toXY = (deg) => {
    const rad = (deg * Math.PI) / 180;
    return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
  };
  const [x1, y1] = toXY(startDeg);
  const [x2, y2] = toXY(endDeg);
  return `M${cx},${cy} L${x1.toFixed(2)},${y1.toFixed(2)} A${r},${r} 0 0 1 ${x2.toFixed(2)},${y2.toFixed(2)} Z`;
}

// A short (1-2 word) label laid out radially inside its slice, from the hub
// outward — read it the way a real physical prize wheel is read: right-side
// up near the top of the wheel, upside-down near the bottom (rotate() is
// applied once to the whole wheel group at landing time, so nothing here
// needs to un-rotate itself — the legend below stays the authoritative,
// always-upright source of the actual prize name).
function sliceLabelTransform(index) {
  return `rotate(${sliceMidDeg(index)} 100 100)`;
}

// The prize (which slice actually wins) was already decided server-side at
// submission time — see app/api/submissions/route.js. This component's
// only job is to visually land on that pre-decided value; there is nothing
// here for a client to influence.
export default function PrizeWheel({ prize, onDone }) {
  const [angle, setAngle] = useState(0);
  const [started, setStarted] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  const winIndex = Math.max(0, PRIZES.findIndex((p) => p.id === prize));
  const winLabel = PRIZES[winIndex]?.label || "your prize";

  useEffect(() => {
    // Read once on mount, independent of whether/when the visitor actually
    // presses "Spin the wheel" — prefers-reduced-motion can only be read
    // client-side (no DOM/matchMedia during SSR), so this is an unavoidable
    // one-time client-only correction, not state that should've been
    // derived during render.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- see comment above
    setReducedMotion(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);

  useEffect(() => {
    // Waits for the visitor to press "Spin the wheel" (see the button in
    // the JSX below) rather than auto-spinning the instant this component
    // mounts — landing on a payoff nobody asked to see yet doesn't feel
    // like winning anything, it just feels like a page finished loading.
    if (!started) return;
    // No "already started" ref guard here — React's dev-only Strict Mode
    // double-invokes this effect (mount -> cleanup -> mount again) precisely
    // so that a *correct* cleanup-and-reschedule survives it. A guard that
    // blocks the second invocation looks harmless but actually breaks that:
    // the first run's setTimeout gets cancelled by the Strict Mode cleanup,
    // and the guard then stops the second run from ever scheduling a
    // replacement — so `revealed` silently never becomes true in dev. The
    // effect below is written to be safely re-run instead (each run
    // schedules its own timer and its own cleanup cancels exactly that one).
    // Lands the winning slice under the fixed 12-o'clock pointer, with a
    // small random offset from dead-center (never past the divider on
    // either side) — an exact center-landing every time reads as suspiciously
    // mechanical; a real wheel never stops at exactly the same spot twice.
    const jitter = reducedMotion ? 0 : (Math.random() - 0.5) * SLICE_DEG * 0.47;
    const landingDeg = 360 - (winIndex * SLICE_DEG + SLICE_DEG / 2);
    const target = reducedMotion ? landingDeg : SPIN_TURNS * 360 + landingDeg + jitter;

    if (reducedMotion) {
      // Jumping straight to the final state in response to the visitor's
      // own "Spin the wheel" click (this effect only runs once `started`
      // flips true) — not state that could've been derived during render.
      // eslint-disable-next-line react-hooks/set-state-in-effect -- see comment above
      setAngle(target);
      setRevealed(true);
      return;
    }

    const raf = requestAnimationFrame(() => setAngle(target));
    const t = setTimeout(() => setRevealed(true), SPIN_MS);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- winIndex is derived from the prize prop, which never changes for a mounted instance
  }, [started, reducedMotion]);

  const primaryLabel = revealed ? "See your full report" : started ? "Spinning…" : "Spin the wheel";
  const status = revealed
    ? "Saved to your submission — no need to note it down."
    : started
    ? "The wheel is turning…"
    : `One spin per audit. Equal odds on all ${PRIZES.length} prizes.`;

  return (
    <div className="prize-wheel-overlay" role="dialog" aria-modal="true" aria-label="Spin to win">
      <div className={`prize-wheel-card${revealed ? " is-revealed" : started ? " is-spinning" : ""}`}>
        <div className="prize-wheel-pane prize-wheel-pane-wheel">
          <div className={`prize-wheel-wrap${started && !revealed ? " is-spinning" : ""}`}>
            <div className="prize-wheel-glow" aria-hidden="true" />
            <div className="prize-wheel-shadow" aria-hidden="true" />
            <div className="prize-wheel-pointer" aria-hidden="true">
              <span className="prize-wheel-pointer-sheen" />
            </div>
            <svg
              viewBox="0 0 200 200"
              className="prize-wheel-svg"
              style={{ transform: `rotate(${angle}deg)`, transitionDuration: reducedMotion ? "0ms" : `${SPIN_MS}ms` }}
            >
              <defs>
                {PRIZES.map((p) => (
                  <radialGradient key={p.id} id={`slice-${p.id}`} cx="50%" cy="50%" r="75%">
                    <stop offset="0%" stopColor="white" stopOpacity="0.14" />
                    <stop offset="55%" stopColor="white" stopOpacity="0" />
                  </radialGradient>
                ))}
                {/* A soft top-down sheen suggesting a lacquered, physical
                   disc rather than a flat vector fill — the single biggest
                   gap between this and a real cast prize wheel. */}
                <radialGradient id="wheelGloss" cx="50%" cy="28%" r="65%">
                  <stop offset="0%" stopColor="#ffffff" stopOpacity="0.35" />
                  <stop offset="55%" stopColor="#ffffff" stopOpacity="0.06" />
                  <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
                </radialGradient>
                {/* One shared clip shared by all 5 photo badges — each badge
                   sits in its own slice's rotated <g>, but at identical local
                   coordinates within that group, so a single clip works for
                   all of them. */}
                <clipPath id="prizePhotoClip">
                  <rect x="129" y="77" width="46" height="46" rx="10" />
                </clipPath>
                <linearGradient id="hubDotGloss" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#f0973a" />
                  <stop offset="100%" stopColor="#d9761c" />
                </linearGradient>
              </defs>
              {/* Uniform dark alternating wedge tones, not a per-prize color
                 key — the photo tile on each slice is what identifies the
                 prize, so the wedges themselves read as one cast disc
                 rather than a pie chart. Three tones (not a strict
                 alternation) so the wrap seam at the last wedge doesn't
                 repeat the first wedge's tone. Hairline dividers between
                 slices are a light-on-dark stroke instead of the paper-tone
                 one a light wheel face would need. */}
              {PRIZES.map((p, i) => (
                <path
                  key={p.id}
                  d={slicePath(i)}
                  fill={i % 2 ? "#222831" : i === PRIZES.length - 1 ? "#1e242c" : "#1b1f26"}
                  stroke="rgba(255, 255, 255, 0.12)"
                  strokeWidth="1"
                />
              ))}
              {PRIZES.map((p, i) => (
                <path key={`${p.id}-sheen`} d={slicePath(i)} fill={`url(#slice-${p.id})`} />
              ))}
              {/* Winning-wedge spotlight, revealed once the wheel stops —
                 sits under the photo medallion so the medallion's own ring
                 highlight (below) reads as the sharp focal point and this
                 just warms the slice around it. */}
              <path
                d={slicePath(winIndex)}
                fill="rgba(217, 118, 28, 0.32)"
                className={`prize-wheel-tint${revealed ? " show" : ""}`}
              />
              {/* No in-slice text: at 5 slices, a label small enough to fit
                 the wedge (and rotated to match it — sideways or upside-down
                 for anything not near the top) was unreadable at a glance,
                 which was the actual complaint. A photo reads fine at any
                 rotation; the always-upright prize list/result panel beside
                 the wheel is the one and only place the prize names are
                 spelled out. Real product photos carry their own busy
                 backgrounds/colors, so — unlike a flat glyph — each one sits
                 in a small white photo-card frame (cover-cropped via the
                 shared clip path) instead of directly on the slice color. */}
              {PRIZES.map((p, i) => (
                <g
                  key={`${p.id}-label`}
                  transform={sliceLabelTransform(i)}
                  className={`prize-wheel-slice-medallion${revealed && p.id === prize ? " is-winner" : ""}`}
                >
                  <rect x="126" y="74" width="52" height="52" rx="12" fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.12)" strokeWidth="1" className="prize-wheel-photo-frame" />
                  <image href={p.image} x="129" y="77" width="46" height="46" preserveAspectRatio="xMidYMid slice" clipPath="url(#prizePhotoClip)" />
                  <rect x="129" y="77" width="46" height="46" rx="10" fill="none" stroke="#ffffff" strokeOpacity="0.1" strokeWidth="1" />
                  {revealed && p.id === prize && (
                    <rect x="126" y="74" width="52" height="52" rx="12" fill="none" stroke="#ffffff" strokeWidth="2.5" className="prize-wheel-medallion-ring" />
                  )}
                </g>
              ))}
              {/* Beveled rim band (dark base + thin inner/outer catch-light
                 lines) instead of a single flat stroke — the detail that
                 reads as "a physical cast disc" rather than a flat cutout. */}
              <circle cx="100" cy="100" r="93" fill="none" stroke="#1c2430" strokeWidth="10" />
              <circle cx="100" cy="100" r="98.3" fill="none" stroke="#ffffff" strokeWidth="1" opacity="0.22" />
              <circle cx="100" cy="100" r="87.5" fill="none" stroke="#000000" strokeWidth="1.2" opacity="0.18" />
              <circle cx="100" cy="100" r="88" fill="url(#wheelGloss)" />
              {/* Beveled hub — a darker outer ring, a lighter mid ring for
                 the catch-light, and a small glowing orange center dot
                 (the one warm accent on an otherwise dark, neutral hub). */}
              <circle cx="100" cy="100" r="19" fill="#1c2430" />
              <circle cx="100" cy="100" r="15.5" fill="none" stroke="#3a4552" strokeWidth="1.2" opacity="0.7" />
              <circle cx="100" cy="100" r="5" fill="url(#hubDotGloss)" className="prize-wheel-hub-dot" />
            </svg>
          </div>
          <div className="prize-wheel-odds-pill">
            <span className="prize-wheel-odds-dot" aria-hidden="true" />
            {`${PRIZES.length} prizes · 1 spin · equal odds`}
          </div>
        </div>

        <div className="prize-wheel-pane prize-wheel-pane-copy">
          <span className="prize-wheel-badge">Your audit is in</span>
          <h2 className="prize-wheel-heading">
            One spin,
            <br />
            one prize
          </h2>
          <p className="prize-wheel-blurb">
            Every completed audit earns one spin. Spin once to see which prize this property gets.
          </p>

          {!revealed && (
            <ol className="prize-wheel-list">
              {PRIZES.map((p, i) => (
                <li key={p.id}>
                  <span className="prize-wheel-list-num">{String(i + 1).padStart(2, "0")}</span>
                  {p.label}
                </li>
              ))}
            </ol>
          )}

          <div className={`prize-wheel-result${revealed ? " show" : ""}`} aria-live="polite">
            {revealed && (
              <>
                <span className="prize-wheel-result-eyebrow">You won</span>
                <p className="prize-wheel-result-name">{winLabel}</p>
                <p className="prize-wheel-result-note">
                  {prize === "aedsmartx"
                    ? "Our team will reach out about your AEDSmartX subscription."
                    : "Our team will follow up to arrange delivery."}
                </p>
              </>
            )}
          </div>

          <div className="prize-wheel-actions">
            <button
              type="button"
              className="btn btn-primary prize-wheel-spin-cta"
              disabled={started && !revealed}
              onClick={() => (revealed ? onDone?.() : setStarted(true))}
            >
              {primaryLabel}
            </button>
          </div>

          <p className="prize-wheel-status">{status}</p>
        </div>
      </div>
    </div>
  );
}
