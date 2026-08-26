"use client";

import { useEffect, useState } from "react";
import { PRIZES } from "@/lib/prizes";

const SLICE_DEG = 360 / PRIZES.length; // 72°
const SPIN_MS = 3800;

function sliceMidDeg(index) {
  return index * SLICE_DEG - 90 + SLICE_DEG / 2; // -90 so slice 0 starts at 12 o'clock
}

function slicePath(index) {
  const startDeg = index * SLICE_DEG - 90;
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
    // presses "Spin to win" — prefers-reduced-motion can only be read
    // client-side (no DOM/matchMedia during SSR), so this is an unavoidable
    // one-time client-only correction, not state that should've been
    // derived during render.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- see comment above
    setReducedMotion(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);

  useEffect(() => {
    // Waits for the visitor to press "Spin to win" (see the button in the
    // JSX below) rather than auto-spinning the instant this component
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
    // Lands the middle of the winning slice under the fixed 12-o'clock
    // pointer: slice i occupies [i*72, (i+1)*72) starting from the top, so
    // rotating the wheel by 360 - (i*72 + 36) degrees brings its center to
    // the top. Extra full turns are purely cosmetic (skipped entirely under
    // reduced-motion, which jumps straight to the final angle with no
    // animated transition at all — see the transitionDuration below, which
    // is set to 0ms in that case rather than just skipping the extra spins).
    const landingDeg = 360 - (winIndex * SLICE_DEG + SLICE_DEG / 2);
    const target = reducedMotion ? landingDeg : 5 * 360 + landingDeg;

    if (reducedMotion) {
      // Jumping straight to the final state in response to the visitor's
      // own "Spin to win" click (this effect only runs once `started`
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

  return (
    <div className="prize-wheel-overlay" role="dialog" aria-modal="true" aria-label="Prize reveal">
      <div className={`prize-wheel-card${revealed ? " is-revealed" : started ? " is-spinning" : ""}`}>
        <span className="landing-eyebrow">
          {revealed ? "Congratulations!" : started ? "Spinning the wheel…" : "Your audit is in"}
        </span>
        <h2 className="landing-h2">{started ? "Your audit is in" : "One spin, one prize"}</h2>

        <div className={`prize-wheel-wrap${started && !revealed ? " is-spinning" : ""}`}>
          <div className="prize-wheel-glow" aria-hidden="true" />
          <div className="prize-wheel-pointer" aria-hidden="true" />
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
            </defs>
            {/* Thin white spokes between slices, a single fine ink ring
               around the rim, plain solid medallions — restrained, on the
               same paper/ink/structure palette as the rest of the app,
               instead of a gold-casino treatment that read as a jarring,
               cheaper detour from everywhere else in this tool. */}
            {PRIZES.map((p, i) => (
              <path key={p.id} d={slicePath(i)} fill={p.color} stroke="#f5f6f3" strokeWidth="1.5" />
            ))}
            {PRIZES.map((p, i) => (
              <path key={`${p.id}-sheen`} d={slicePath(i)} fill={`url(#slice-${p.id})`} />
            ))}
            {/* No in-slice text: at 5 slices, a label small enough to fit
               the wedge (and rotated to match it — sideways or upside-down
               for anything not near the top) was unreadable at a glance,
               which was the actual complaint. An icon reads fine at any
               rotation; the always-upright legend below is the one and
               only place the prize names are spelled out. */}
            {PRIZES.map((p, i) => (
              <g
                key={`${p.id}-label`}
                transform={sliceLabelTransform(i)}
                className={`prize-wheel-slice-medallion${revealed && p.id === prize ? " is-winner" : ""}`}
              >
                {/* A plain image would blend into whichever slice color sits
                   behind it — the white, thin-ringed medallion gives every
                   icon the same guaranteed-contrast backdrop regardless of
                   slice color. */}
                <circle cx="158" cy="100" r="20" fill="#ffffff" stroke="#d7d2c4" strokeWidth="1.5" className="prize-wheel-medallion-ring" />
                <image href={p.image} x="143" y="85" width="30" height="30" />
              </g>
            ))}
            <circle cx="100" cy="100" r="94" fill="none" stroke="#1c2430" strokeWidth="2" />
            <circle cx="100" cy="100" r="18" fill="#1c2430" />
            <circle cx="100" cy="100" r="5" fill="#f5f6f3" opacity="0.85" />
          </svg>
        </div>

        <ul className="prize-wheel-legend">
          {PRIZES.map((p) => (
            <li key={p.id} className={p.id === prize && revealed ? "won" : undefined}>
              <span className="prize-wheel-legend-thumb" style={{ background: p.color }}>
                {/* eslint-disable-next-line @next/next/no-img-element -- small static icon inside an SVG-adjacent legend, not page content */}
                <img src={p.image} alt="" />
              </span>
              {p.label}
            </li>
          ))}
        </ul>

        {!started && (
          <button type="button" className="btn btn-primary prize-wheel-spin-cta" onClick={() => setStarted(true)}>
            Spin to Win
          </button>
        )}

        <div className={`prize-wheel-reveal${revealed ? " show" : ""}`} aria-live="polite">
          {revealed && (
            <>
              <p className="prize-wheel-headline">
                You won: <b>{winLabel}</b>
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
