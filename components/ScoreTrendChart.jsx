"use client";

import { useState } from "react";

const WIDTH = 640;
const HEIGHT = 180;
const PAD_LEFT = 34;
const PAD_RIGHT = 16;
const PAD_TOP = 16;
const PAD_BOTTOM = 28;

function fmtDate(d) {
  const dt = new Date(d + "T00:00:00");
  if (Number.isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// A single-series (avg PREPARED score over time) line chart — no legend
// needed per the one-series rule, but it still ships the hover
// crosshair+tooltip a line chart is expected to have.
export default function ScoreTrendChart({ data }) {
  const [hoverIdx, setHoverIdx] = useState(null);
  if (!data || data.length < 2) return null;

  const innerW = WIDTH - PAD_LEFT - PAD_RIGHT;
  const innerH = HEIGHT - PAD_TOP - PAD_BOTTOM;
  const xFor = (i) => PAD_LEFT + (data.length === 1 ? innerW / 2 : (i / (data.length - 1)) * innerW);
  const yFor = (pct) => PAD_TOP + innerH - (pct / 100) * innerH;

  const points = data.map((d, i) => [xFor(i), yFor(d.avgPreparedPct)]);
  const path = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const gridLines = [0, 25, 50, 75, 100];

  const hover = hoverIdx != null ? data[hoverIdx] : null;
  const hoverPoint = hoverIdx != null ? points[hoverIdx] : null;

  return (
    <div className="trend-chart-wrap">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label="Average PREPARED score over time"
        onMouseLeave={() => setHoverIdx(null)}
      >
        {gridLines.map((g) => (
          <g key={g}>
            <line x1={PAD_LEFT} x2={WIDTH - PAD_RIGHT} y1={yFor(g)} y2={yFor(g)} className="trend-grid" />
            <text x={PAD_LEFT - 8} y={yFor(g)} className="trend-axis-label" textAnchor="end" dominantBaseline="middle">
              {g}
            </text>
          </g>
        ))}
        <path d={path} className="trend-line" fill="none" />
        {points.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r={hoverIdx === i ? 5 : 3} className="trend-dot" />
        ))}
        {/* wide invisible hit targets, one per point, bigger than the mark itself */}
        {points.map(([x], i) => (
          <rect
            key={i}
            x={x - innerW / data.length / 2}
            y={PAD_TOP}
            width={Math.max(innerW / data.length, 8)}
            height={innerH}
            fill="transparent"
            onMouseEnter={() => setHoverIdx(i)}
          />
        ))}
        {data.map((d, i) =>
          i === 0 || i === data.length - 1 ? (
            <text key={i} x={xFor(i)} y={HEIGHT - 6} className="trend-axis-label" textAnchor={i === 0 ? "start" : "end"}>
              {fmtDate(d.date)}
            </text>
          ) : null
        )}
        {hoverPoint && (
          <line x1={hoverPoint[0]} x2={hoverPoint[0]} y1={PAD_TOP} y2={PAD_TOP + innerH} className="trend-crosshair" />
        )}
      </svg>
      {hover && (
        <div
          className="trend-tooltip"
          style={{ left: `${(hoverPoint[0] / WIDTH) * 100}%`, top: `${(hoverPoint[1] / HEIGHT) * 100}%` }}
        >
          <div className="trend-tooltip-date">{fmtDate(hover.date)}</div>
          <div className="trend-tooltip-val">
            {hover.avgPreparedPct}% avg &middot; {hover.count} audit{hover.count === 1 ? "" : "s"}
          </div>
        </div>
      )}
    </div>
  );
}
