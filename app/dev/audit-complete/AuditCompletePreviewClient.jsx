"use client";

import { useState } from "react";
import AuditCompleteCard from "@/components/AuditCompleteCard";

// Bumping `run` remounts the card, which restarts every CSS entrance
// animation from the top — the whole point of this page is watching that
// sequence repeatedly without a page reload.
export default function AuditCompletePreviewClient() {
  const [run, setRun] = useState(0);
  const [unitCount, setUnitCount] = useState(2);

  return (
    <div className="wizard-page">
      <div className="wizard-main">
        <div className="wizard-card" style={{ maxWidth: 640 }}>
          <AuditCompleteCard
            key={run}
            firstName="Sagar"
            hotelName="Courtyard Pune Hinjewadi"
            sectionCount={8}
            unitCount={unitCount}
            answeredCount={42}
          />
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 20, flexWrap: "wrap", justifyContent: "center" }}>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setRun((r) => r + 1)}>
            Replay animation
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              // 0 units is the "no AED installed" path, where the units stat
              // is deliberately hidden rather than reading "0 inspected".
              setUnitCount((u) => (u === 0 ? 2 : 0));
              setRun((r) => r + 1);
            }}
          >
            {unitCount === 0 ? "Show with AED units" : "Show 'no AED' variant"}
          </button>
        </div>
      </div>
    </div>
  );
}
