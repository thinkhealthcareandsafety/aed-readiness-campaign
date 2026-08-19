"use client";

import { useEffect, useMemo, useState } from "react";
import { PRIZES } from "@/lib/prizes";

const SLICE_DEG = 360 / PRIZES.length; // 72°
const SPIN_MS = 3800;

// Confetti is purely decorative and never carries information (the prize
// name/legend highlight do that), so it's fine to generate its randomness
// on the client with Math.random() — nothing here needs to be
// cryptographically fair or server-verifiable, unlike the prize pick itself.
const CONFETTI_COLORS = ["var(--accent)", "var(--structure)", "var(--ready)", "var(--warn)", "var(--accent-deep)"];
function makeConfetti(count) {
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    left: Math.random() * 100,
    delay: Math.random() * 0.5,
    duration: 1.6 + Math.random() * 1.1,
    drift: (Math.random() - 0.5) * 140,
    rotate: Math.random() * 720 - 360,
    size: 6 + Math.random() * 6,
    color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
  }));
}

// Renders the wheel as plain colored pie slices with NO text or icons drawn
// inside them — anything drawn inside a slice ends up sideways or upside
// down once the wheel actually rotates to its landing angle, which is
// exactly the kind of "looked fine in the mockup, broken the moment it
// spins" bug worth designing around rather than patching later. The color
// legend below the wheel (and the big reveal line once it stops) is where
// the actual prize name lives instead.
function slicePath(index) {
  const startDeg = index * SLICE_DEG - 90; // -90 so slice 0 starts at 12 o'clock
  const endDeg = startDeg + SLICE_DEG;
  const cx = 100;
  const cy = 100;
  const r = 96;
  const toXY = (deg) => {
    const rad = (deg * Math.PI) / 180;
    return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
  };
  const [x1, y1] = toXY(startDeg);
  const [x2, y2] = toXY(endDeg);
  return `M${cx},${cy} L${x1.toFixed(2)},${y1.toFixed(2)} A${r},${r} 0 0 1 ${x2.toFixed(2)},${y2.toFixed(2)} Z`;
}

// The prize (which slice actually wins) was already decided server-side at
// submission time — see app/api/submissions/route.js. This component's
// only job is to visually land on that pre-decided value; there is nothing
// here for a client to influence.
export default function PrizeWheel({ prize, onDone }) {
  const [angle, setAngle] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  const winIndex = Math.max(0, PRIZES.findIndex((p) => p.id === prize));
  const winLabel = PRIZES[winIndex]?.label || "your prize";
  const confetti = useMemo(() => makeConfetti(36), []);

  useEffect(() => {
    // No "already started" ref guard here — React's dev-only Strict Mode
    // double-invokes this effect (mount -> cleanup -> mount again) precisely
    // so that a *correct* cleanup-and-reschedule survives it. A guard that
    // blocks the second invocation looks harmless but actually breaks that:
    // the first run's setTimeout gets cancelled by the Strict Mode cleanup,
    // and the guard then stops the second run from ever scheduling a
    // replacement — so `revealed` silently never becomes true in dev. The
    // effect below is written to be safely re-run instead (each run
    // schedules its own timer and its own cleanup cancels exactly that one).
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // prefers-reduced-motion can only be read client-side (no DOM/matchMedia
    // during SSR), so this is an unavoidable one-time client-only
    // correction — not state that should've been derived during render.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- see comment above
    setReducedMotion(reduced);
    // Lands the middle of the winning slice under the fixed 12-o'clock
    // pointer: slice i occupies [i*72, (i+1)*72) starting from the top, so
    // rotating the wheel by 360 - (i*72 + 36) degrees brings its center to
    // the top. Extra full turns are purely cosmetic (skipped entirely under
    // reduced-motion, which jumps straight to the final angle with no
    // animated transition at all — see the transitionDuration below, which
    // is set to 0ms in that case rather than just skipping the extra spins).
    const landingDeg = 360 - (winIndex * SLICE_DEG + SLICE_DEG / 2);
    const target = reduced ? landingDeg : 5 * 360 + landingDeg;

    if (reduced) {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once for this prize; winIndex is derived from the prize prop, which never changes for a mounted instance
  }, []);

  return (
    <div className="prize-wheel-overlay" role="dialog" aria-modal="true" aria-label="Prize reveal">
      {revealed && (
        <div className="prize-wheel-confetti" aria-hidden="true">
          {confetti.map((c) => (
            <span
              key={c.id}
              className="confetto"
              style={{
                left: `${c.left}%`,
                background: c.color,
                width: c.size,
                height: c.size * 0.4,
                animationDelay: `${c.delay}s`,
                animationDuration: `${c.duration}s`,
                "--drift": `${c.drift}px`,
                "--rotate": `${c.rotate}deg`,
              }}
            />
          ))}
        </div>
      )}
      <div className={`prize-wheel-card${revealed ? " is-revealed" : " is-spinning"}`}>
        <span className="landing-eyebrow dark">
          {revealed ? "Congratulations!" : "Spinning the wheel…"}
        </span>
        <h2 className="landing-h2">Your audit is in</h2>

        <div className={`prize-wheel-wrap${revealed ? "" : " is-spinning"}`}>
          <div className="prize-wheel-glow" aria-hidden="true" />
          <div className="prize-wheel-pointer" aria-hidden="true" />
          <svg
            viewBox="0 0 200 200"
            className="prize-wheel-svg"
            style={{ transform: `rotate(${angle}deg)`, transitionDuration: reducedMotion ? "0ms" : `${SPIN_MS}ms` }}
          >
            <defs>
              <radialGradient id="hubShine" cx="35%" cy="30%" r="75%">
                <stop offset="0%" stopColor="var(--paper-raised)" />
                <stop offset="100%" stopColor="var(--structure-tint)" />
              </radialGradient>
              {PRIZES.map((p) => (
                <radialGradient key={p.id} id={`slice-${p.id}`} cx="50%" cy="50%" r="75%">
                  <stop offset="0%" stopColor="white" stopOpacity="0.34" />
                  <stop offset="55%" stopColor="white" stopOpacity="0" />
                </radialGradient>
              ))}
            </defs>
            {PRIZES.map((p, i) => (
              <path key={p.id} d={slicePath(i)} fill={p.color} stroke="var(--paper-raised)" strokeWidth="1.5" />
            ))}
            {PRIZES.map((p, i) => (
              <path key={`${p.id}-sheen`} d={slicePath(i)} fill={`url(#slice-${p.id})`} />
            ))}
            <circle cx="100" cy="100" r="90" fill="none" stroke="var(--paper-raised)" strokeWidth="4" />
            <circle cx="100" cy="100" r="16" fill="url(#hubShine)" stroke="var(--line-strong)" strokeWidth="1.5" />
          </svg>
        </div>

        <ul className="prize-wheel-legend">
          {PRIZES.map((p) => (
            <li key={p.id} className={p.id === prize && revealed ? "won" : undefined}>
              <span className="swatch" style={{ background: p.color }} />
              {p.label}
            </li>
          ))}
        </ul>

        <div className={`prize-wheel-reveal${revealed ? " show" : ""}`} aria-live="polite">
          {revealed && (
            <>
              <p className="prize-wheel-headline">
                🎉 You won: <b>{winLabel}</b>
              </p>
              <p className="prize-wheel-note">
                {prize === "aedsmartx"
                  ? "Our team will reach out about your AEDSmartX subscription."
                  : "Our team will follow up to arrange delivery."}
              </p>
              <button type="button" className="btn btn-primary prize-wheel-cta" onClick={onDone}>
                See your full report
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
