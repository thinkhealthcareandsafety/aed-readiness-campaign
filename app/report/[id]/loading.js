// Shown by the App Router while report/[id]/page.js does its async work
// (submission fetch, schema fetch, scoring) — without this file, clicking
// "See full report" (either straight from the wizard, or from the prize
// wheel's onDone) had a dead gap with no feedback at all between the click
// and the report actually painting, since router.push() itself never
// blocks or shows anything on its own.
export default function ReportLoading() {
  return (
    <div className="report-loading">
      <div className="report-loading-spinner" aria-hidden="true" />
      <p className="report-loading-text">Preparing your readiness report…</p>
    </div>
  );
}
