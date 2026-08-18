"use client";

import { useEffect, useRef, useState } from "react";

const TWEEN_MS = 550;

// A running "X / Y pts" badge that tweens to its new value and pulses on
// every increase, with a floating "+N" — the score itself already exists
// server-side (lib/genericScoring.js), this is purely the reward feedback
// layer so answering a question *feels* like it counted for something,
// instead of the payoff being deferred to the report page at the very end.
export default function LiveScore({ points, max }) {
  const [display, setDisplay] = useState(points);
  const [pulse, setPulse] = useState(false);
  const [gain, setGain] = useState(null);

  const displayRef = useRef(points);
  const prevPointsRef = useRef(points);
  const rafRef = useRef(null);
  const gainIdRef = useRef(0);
  const gainTimerRef = useRef(null);
  const pulseTimerRef = useRef(null);
  const reducedMotionRef = useRef(false);

  useEffect(() => {
    reducedMotionRef.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  useEffect(() => {
    const prev = prevPointsRef.current;
    if (points === prev) return;
    const diff = points - prev;
    prevPointsRef.current = points;

    if (diff > 0) {
      gainIdRef.current += 1;
      setGain({ id: gainIdRef.current, amount: diff });
      setPulse(true);
      clearTimeout(gainTimerRef.current);
      clearTimeout(pulseTimerRef.current);
      gainTimerRef.current = setTimeout(() => setGain(null), 950);
      pulseTimerRef.current = setTimeout(() => setPulse(false), 420);
    }

    if (reducedMotionRef.current) {
      displayRef.current = points;
      setDisplay(points);
      return;
    }

    cancelAnimationFrame(rafRef.current);
    const from = displayRef.current;
    const to = points;
    const start = performance.now();
    function tick(now) {
      const t = Math.min(1, (now - start) / TWEEN_MS);
      const eased = 1 - Math.pow(1 - t, 3);
      const next = Math.round(from + (to - from) * eased);
      displayRef.current = next;
      setDisplay(next);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [points]);

  useEffect(
    () => () => {
      cancelAnimationFrame(rafRef.current);
      clearTimeout(gainTimerRef.current);
      clearTimeout(pulseTimerRef.current);
    },
    []
  );

  return (
    <div className={`live-score${pulse ? " live-score-pulse" : ""}`} aria-live="polite">
      <span className="live-score-cap">Live score</span>
      <span className="live-score-value tabular">{display}</span>
      <span className="live-score-max tabular">/ {max} pts</span>
      {gain && (
        <span className="live-score-gain" key={gain.id}>
          +{gain.amount}
        </span>
      )}
    </div>
  );
}
