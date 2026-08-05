import { notFound } from "next/navigation";
import Link from "next/link";
import { getSubmission, getFormSchema } from "@/lib/db";
import { scoreSubmission, expandUnitQuestions } from "@/lib/genericScoring";
import { barColor } from "@/lib/scoreColor";
import PrintButton from "./PrintButton";

export const dynamic = "force-dynamic";

function ringStyle(pct) {
  return {
    background: `conic-gradient(var(--accent) ${pct * 3.6}deg, var(--line) ${pct * 3.6}deg)`,
    borderRadius: "50%",
    width: "100%",
    height: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  };
}

export default async function ReportPage({ params }) {
  const { id } = await params;
  const submission = getSubmission(id);
  if (!submission) return notFound();

  // Expand to however many AED units this specific submission reported —
  // without this, a submission with 3+ AEDs would redisplay with its extra
  // units' answers scored as 0 even though the API scored them correctly at
  // submission time (see app/api/submissions/route.js).
  const schema = expandUnitQuestions(getFormSchema(), submission.answers);
  const scored = scoreSubmission(schema, submission.answers);
  const pct = scored.total.max > 0 ? Math.round((scored.total.points / scored.total.max) * 100) : 0;
  const hotelName = submission.hotel;
  const name = `${submission.first_name} ${submission.last_name}`.trim();
  const hasAED = submission.has_aed !== "no";

  const preparedRows = scored.sections.filter((s) => !s.unscored && !s.isSupplementary);
  const supplementaryRows = scored.sections.filter((s) => !s.unscored && s.isSupplementary);

  return (
    <div className="report-page">
      <div className="no-print" style={{ marginBottom: 20 }}>
        <Link href="/">&larr; New audit</Link>
      </div>

      <div className="score-hero">
        <div className="score-ring">
          <div style={ringStyle(pct)}>
            <div
              style={{
                width: "78%",
                height: "78%",
                borderRadius: "50%",
                background: "var(--paper-raised)",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <span className="tabular" style={{ fontFamily: "var(--font-mono)", fontSize: "2rem", fontWeight: 700 }}>
                {scored.total.points}
              </span>
              <span style={{ fontSize: ".7rem", color: "var(--ink-soft)" }}>of {scored.total.max}</span>
            </div>
          </div>
        </div>
        <div>
          <div style={{ textTransform: "uppercase", letterSpacing: ".1em", fontSize: ".72rem", fontWeight: 700, color: "var(--accent-deep)" }}>
            Detailed AED Report
          </div>
          <h1 style={{ fontSize: "1.7rem", marginTop: 6 }}>{hotelName || "Your property"}</h1>
          <p style={{ color: "var(--ink-soft)", marginTop: 4 }}>
            Submitted by {name || "—"} &middot; {new Date(submission.created_at).toLocaleDateString()}
          </p>
          <p style={{ marginTop: 10 }}>
            <b className="tabular">{scored.prepared.points}/{scored.prepared.max}</b> PREPARED core score &middot;{" "}
            <b className="tabular">{scored.supplementary.points}/{scored.supplementary.max}</b> supplementary
          </p>
        </div>
        <PrintButton />
      </div>

      {!hasAED && (
        <div className="callout" style={{ marginTop: 24 }}>
          This property reported <b>no AED installed</b>. All PREPARED sections are scored 0 until a unit is in
          place — the fastest way to move this number is procuring and mounting an AED, then re-running this audit.
        </div>
      )}

      <h2 style={{ fontSize: "1.15rem", marginTop: 36, marginBottom: 12 }}>PREPARED breakdown</h2>
      <div className="breakdown-grid">
        {preparedRows.map((s) => {
          const p = s.max > 0 ? Math.round((s.points / s.max) * 100) : 0;
          return (
            <div className="sec-card" key={s.id}>
              <div className="row">
                <span className="name">{s.title}</span>
                <span className="val tabular">
                  {s.points}/{s.max}
                </span>
              </div>
              <div className="bar-track">
                <div className="bar-fill" style={{ width: `${p}%`, background: barColor(p) }} />
              </div>
            </div>
          );
        })}
      </div>

      {supplementaryRows.length > 0 && (
        <>
          <h2 style={{ fontSize: "1.15rem", marginTop: 32, marginBottom: 12 }}>Supplementary sections</h2>
          <div className="breakdown-grid">
            {supplementaryRows.map((s) => {
              const p = s.max > 0 ? Math.round((s.points / s.max) * 100) : 0;
              return (
                <div className="sec-card" key={s.id}>
                  <div className="row">
                    <span className="name">{s.title}</span>
                    <span className="val tabular">
                      {s.points}/{s.max}
                    </span>
                  </div>
                  <div className="bar-track">
                    <div className="bar-fill" style={{ width: `${p}%`, background: barColor(p) }} />
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {scored.qualifiesForCertificate ? (
        <div className="certificate">
          <div className="eyebrow">Think Health &middot; AED Readiness Campaign</div>
          <h2>Good Samaritan Warrior</h2>
          <div className="name">{name || "Awardee"}</div>
          <p style={{ color: "var(--ink-soft)", marginTop: 8 }}>
            has demonstrated CPR and AED operating readiness in support of {hotelName || "their property"}&rsquo;s
            emergency response capability.
          </p>
          <p className="meta">Issued {new Date(submission.created_at).toLocaleDateString()}</p>
        </div>
      ) : (
        <div className="callout structure" style={{ marginTop: 32 }}>
          The Good Samaritan Warrior certificate is awarded once every certificate-gated question in the form is
          answered as required (by default: CPR and AED training). Complete that training and resubmit to unlock it.
        </div>
      )}
    </div>
  );
}
