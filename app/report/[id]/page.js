import { notFound } from "next/navigation";
import { getSubmission, getFormSchema } from "@/lib/db";
import { scoreSubmission, expandUnitQuestions } from "@/lib/genericScoring";
import { buildQuestionRows, finalObservation } from "@/lib/reportInsights";
import { prizeLabel, prizeRequiresDelivery } from "@/lib/prizes";
import { formatCertificateNumber } from "@/lib/certificateNumber";
import ReportDashboardClient from "./ReportDashboardClient";

export const dynamic = "force-dynamic";

export default async function ReportPage({ params }) {
  const { id } = await params;
  const submission = await getSubmission(id);
  if (!submission) return notFound();

  const schema = expandUnitQuestions(await getFormSchema(), submission.answers);
  const scored = scoreSubmission(schema, submission.answers);
  const pct = scored.total.max > 0 ? Math.round((scored.total.points / scored.total.max) * 100) : 0;
  const hotelName = submission.hotel;
  const name = `${submission.first_name || ""} ${submission.last_name || ""}`.trim();
  const hasAED = submission.has_aed !== "no";
  const wonPrizeLabel = prizeLabel(submission.prize);
  const needsDelivery = prizeRequiresDelivery(submission.prize);
  const deliverySaved = needsDelivery && !!submission.delivery_submitted_at;
  const deliveryAddress = deliverySaved
    ? {
        name: submission.delivery_name,
        address1: submission.delivery_address1,
        address2: submission.delivery_address2,
        city: submission.delivery_city,
        state: submission.delivery_state,
        postalCode: submission.delivery_postal_code,
        country: submission.delivery_country,
        notes: submission.delivery_notes,
      }
    : null;
  const assessmentDate = new Date(submission.created_at);
  const certificateNumber = scored.qualifiesForCertificate
    ? formatCertificateNumber(assessmentDate, submission.certificate_number)
    : null;

  const preparedRows = scored.sections.filter((s) => !s.unscored && !s.isSupplementary);
  const supplementaryRows = scored.sections.filter((s) => !s.unscored && s.isSupplementary);

  const insightRows = hasAED ? buildQuestionRows(schema, submission.answers) : [];
  const criticalCount = insightRows.filter((r) => r.status === "critical").length;
  const warnCount = insightRows.filter((r) => r.status === "warn").length;
  const goodCount = insightRows.filter((r) => r.status === "good").length;

  const insightSections = [];
  for (const row of insightRows) {
    let bucket = insightSections.find((s) => s.title === row.section);
    if (!bucket) {
      bucket = { title: row.section, letter: row.letter, rows: [] };
      insightSections.push(bucket);
    }
    bucket.rows.push(row);
  }

  const finalObsText = finalObservation(pct, criticalCount);

  return (
    <ReportDashboardClient
      submission={submission}
      scored={scored}
      pct={pct}
      hotelName={hotelName}
      name={name}
      hasAED={hasAED}
      wonPrizeLabel={wonPrizeLabel}
      needsDelivery={needsDelivery}
      deliverySaved={deliverySaved}
      deliveryAddress={deliveryAddress}
      assessmentDate={assessmentDate}
      certificateNumber={certificateNumber}
      preparedRows={preparedRows}
      supplementaryRows={supplementaryRows}
      insightRows={insightRows}
      criticalCount={criticalCount}
      warnCount={warnCount}
      goodCount={goodCount}
      insightSections={insightSections}
      finalObsText={finalObsText}
    />
  );
}
