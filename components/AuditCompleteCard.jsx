"use client";

// The moment every PREPARED letter has turned to a tick. Until now this
// step was a single flat text callout — the one point in a 14-step audit
// where the responder has genuinely finished something, and it read like a
// form validation message.
//
// Deliberately a *seal*, not confetti: this product's whole promise is that
// a property's AED readiness has been formally assessed, so the completion
// beat that fits is a document being stamped, not a party. Everything here
// uses the app's own tokens (--ready green, --structure teal, --accent
// orange) rather than a celebration palette borrowed from somewhere else.
//
// The stat row is real data, never decoration — it's what makes this read
// as "a deliverable was produced" rather than "a form was submitted".
export default function AuditCompleteCard({ firstName, hotelName, sectionCount, unitCount, answeredCount }) {
  return (
    <div className="audit-complete">
      <div className="audit-complete-seal" aria-hidden="true">
        <span className="audit-complete-pulse" />
        <svg viewBox="0 0 80 80" className="audit-complete-seal-svg">
          <circle className="seal-ring" cx="40" cy="40" r="34" fill="none" strokeWidth="3" />
          <path className="seal-check" d="M25 41.5 L35.5 52 L56 30" fill="none" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>

      <h3 className="audit-complete-title">Audit complete</h3>
      <p className="audit-complete-sub">
        {firstName ? `${firstName}, every` : "Every"} section is recorded
        {hotelName ? (
          <>
            {" "}for <b>{hotelName}</b>
          </>
        ) : null}
        .
      </p>

      <div className="audit-complete-stats">
        <div className="audit-complete-stat">
          <span className="audit-complete-stat-val tabular">{sectionCount}</span>
          <span className="audit-complete-stat-label">Sections assessed</span>
        </div>
        {unitCount > 0 && (
          <div className="audit-complete-stat">
            <span className="audit-complete-stat-val tabular">{unitCount}</span>
            <span className="audit-complete-stat-label">AED unit{unitCount === 1 ? "" : "s"} inspected</span>
          </div>
        )}
        <div className="audit-complete-stat">
          <span className="audit-complete-stat-val tabular">{answeredCount}</span>
          <span className="audit-complete-stat-label">Checks answered</span>
        </div>
      </div>

      <p className="audit-complete-next">
        Press <b>Submit audit</b> to lock this in and reveal your PREPARED score and full readiness report.
      </p>
    </div>
  );
}
