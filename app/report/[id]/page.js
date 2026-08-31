import { notFound } from "next/navigation";
import Link from "next/link";
import { getSubmission, getFormSchema } from "@/lib/db";
import { scoreSubmission, expandUnitQuestions } from "@/lib/genericScoring";
import { buildQuestionRows, finalObservation } from "@/lib/reportInsights";
import { barColor } from "@/lib/scoreColor";
import { prizeLabel } from "@/lib/prizes";
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

const STATUS_LABEL = { good: "Good", warn: "Review soon", critical: "Needs attention" };

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
  const wonPrizeLabel = prizeLabel(submission.prize);
  const assessmentDate = new Date(submission.created_at);

  const preparedRows = scored.sections.filter((s) => !s.unscored && !s.isSupplementary);
  const supplementaryRows = scored.sections.filter((s) => !s.unscored && s.isSupplementary);

  const insightRows = hasAED ? buildQuestionRows(schema, submission.answers) : [];
  const criticalCount = insightRows.filter((r) => r.status === "critical").length;
  const warnCount = insightRows.filter((r) => r.status === "warn").length;
  const insightSections = [];
  for (const row of insightRows) {
    let bucket = insightSections.find((s) => s.title === row.section);
    if (!bucket) {
      bucket = { title: row.section, letter: row.letter, rows: [] };
      insightSections.push(bucket);
    }
    bucket.rows.push(row);
  }

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
            Submitted by {name || "—"} &middot; {assessmentDate.toLocaleDateString()}
          </p>
          <p style={{ marginTop: 10 }}>
            <b className="tabular">{scored.prepared.points}/{scored.prepared.max}</b> PREPARED core score &middot;{" "}
            <b className="tabular">{scored.supplementary.points}/{scored.supplementary.max}</b> supplementary
          </p>
        </div>
        <PrintButton />
      </div>

      {wonPrizeLabel && (
        <div className="callout ready no-print" style={{ marginTop: 20 }}>
          🎁 Prize won: <b>{wonPrizeLabel}</b> — our team will follow up about {submission.prize === "aedsmartx" ? "your subscription" : "delivery"}.
        </div>
      )}

      {!hasAED && (
        <div className="callout" style={{ marginTop: 24 }}>
          This property reported <b>no AED installed</b>. All PREPARED sections are scored 0 until a unit is in
          place — the fastest way to move this number is procuring and mounting an AED, then re-running this audit.
        </div>
      )}

      <h2 style={{ fontSize: "1.05rem", marginTop: 36, marginBottom: 14 }}>Assessment information</h2>
      <div className="report-info-grid">
        <div><span className="k">Hotel</span><span className="v">{hotelName || "—"}</span></div>
        <div><span className="k">Contact</span><span className="v">{name || "—"}</span></div>
        <div><span className="k">Email</span><span className="v">{submission.email || "—"}</span></div>
        <div><span className="k">Phone</span><span className="v">{submission.phone || "—"}</span></div>
        <div><span className="k">Assessment date</span><span className="v">{assessmentDate.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}</span></div>
        <div><span className="k">Overall score</span><span className="v tabular">{scored.total.points} / {scored.total.max}</span></div>
      </div>

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

      {insightSections.length > 0 && (
        <>
          <h2 style={{ fontSize: "1.15rem", marginTop: 40, marginBottom: 4 }}>Detailed assessment &amp; recommendations</h2>
          <p style={{ color: "var(--ink-soft)", fontSize: ".92rem", marginBottom: 4 }}>
            Every answer you gave, in plain language — {criticalCount > 0 ? (
              <>including <b style={{ color: "var(--notready)" }}>{criticalCount} item{criticalCount === 1 ? "" : "s"} needing attention</b>{warnCount > 0 ? <> and {warnCount} worth a closer look</> : null}.</>
            ) : warnCount > 0 ? (
              <>with {warnCount} item{warnCount === 1 ? "" : "s"} worth a closer look.</>
            ) : (
              "everything here checks out."
            )}
          </p>

          {insightSections.map((sec) => (
            <div className="insight-section" key={sec.title}>
              <div className="insight-section-head">
                <span className="letter">{sec.letter}</span>
                <span>{sec.title}</span>
              </div>
              {sec.rows.map((row) => (
                <div className={`insight-row status-${row.status}`} key={row.id}>
                  <div className="insight-body">
                    <div className="insight-top">
                      <span className="insight-label">{row.label}</span>
                      {row.status !== "info" && <span className={`insight-pill ${row.status}`}>{STATUS_LABEL[row.status]}</span>}
                    </div>
                    <div className="insight-answer">{row.answerText}</div>
                    <p className="insight-rec">{row.recommendation}</p>
                  </div>
                </div>
              ))}
            </div>
          ))}

          <div className={`callout no-print ${criticalCount > 0 ? "notready" : warnCount > 0 ? "warn" : "ready"}`} style={{ marginTop: 24 }}>
            {finalObservation(pct, criticalCount)}
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
          <p className="meta">Issued {assessmentDate.toLocaleDateString()}</p>
        </div>
      ) : (
        <div className="callout structure" style={{ marginTop: 32 }}>
          The Good Samaritan Warrior certificate is awarded once every certificate-gated question in the form is
          answered as required (by default: CPR and AED training). Complete that training and resubmit to unlock it.
        </div>
      )}

      <div className="report-conclusion">
        <p>
          Your participation in the Think Health AED Readiness Campaign demonstrates your commitment toward
          emergency preparedness and guest safety. Regular AED inspections, timely maintenance, responder training,
          and readiness monitoring are essential for effective emergency response.
        </p>
        <p>We strongly recommend periodic reassessment and refresher training to maintain a high level of readiness.</p>
        <p>Thank you for supporting a safer property.</p>
        <p style={{ marginTop: 10 }}>
          Regards,
          <br />
          Think Health Campaign Team
        </p>
      </div>
    </div>
  );
}
