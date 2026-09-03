// Every date this app renders goes through here, with an explicit locale
// rather than the `undefined` ambient one.
//
// `toLocaleDateString(undefined, ...)` resolves to whatever locale the
// *runtime* happens to have, which is not the same on both sides of an SSR
// render: Node formatted the report's assessment date as "Sep 3, 2026"
// while the browser re-rendered it as "3 Sept 2026", tripping a React
// hydration mismatch that threw away and re-rendered that whole subtree on
// every report load (and visibly flickered the date while doing it).
//
// en-IN because that's who this campaign is for — Marriott properties
// across India — so "3 Sep 2026" is the form a responder reading their own
// report expects. The point is less which locale than that it's pinned:
// server and client must agree, and they can only do that if it's stated.
export const REPORT_LOCALE = "en-IN";

// The report's standard date: "3 Sep 2026".
export function formatReportDate(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(REPORT_LOCALE, { day: "numeric", month: "short", year: "numeric" });
}
