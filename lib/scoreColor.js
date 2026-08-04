// Shared score-tier color convention — used by both the individual report
// page and the admin analytics dashboard, so a percentage reads the same
// color everywhere in the app: green >=80, amber/accent >=50, red below.
export function barColor(pct) {
  if (pct >= 80) return "var(--ready)";
  if (pct >= 50) return "var(--accent)";
  return "var(--notready)";
}
