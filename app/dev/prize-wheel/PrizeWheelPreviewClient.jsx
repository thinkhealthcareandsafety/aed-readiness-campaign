"use client";

import { useState } from "react";
import PrizeWheel from "@/components/PrizeWheel";

export default function PrizeWheelPreviewClient({ prizes }) {
  const [active, setActive] = useState(null);
  const [runId, setRunId] = useState(0);

  return (
    <div style={{ padding: 40, fontFamily: "var(--font-body)" }}>
      <h1 style={{ marginBottom: 6 }}>Prize wheel preview</h1>
      <p style={{ color: "var(--ink-soft)", marginBottom: 24 }}>
        Dev-only page (404s in production) — pick a prize to spin the wheel exactly as it appears after a real
        submission, without filling out the audit form each time.
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
        {prizes.map((p) => (
          <button
            key={p.id}
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setActive(p.id);
              setRunId((n) => n + 1);
            }}
          >
            Spin: {p.label}
          </button>
        ))}
      </div>

      {active && (
        // key={runId} forces a full remount so re-clicking the same prize
        // (or any prize) always restarts the spin animation from scratch,
        // the same way a real fresh submission would.
        <PrizeWheel key={runId} prize={active} onDone={() => setActive(null)} />
      )}
    </div>
  );
}
