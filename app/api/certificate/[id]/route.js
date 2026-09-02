import { NextResponse } from "next/server";
import { getSubmission, getFormSchema } from "@/lib/db";
import { scoreSubmission, expandUnitQuestions } from "@/lib/genericScoring";
import { formatCertificateNumber } from "@/lib/certificateNumber";
import { renderCertificate } from "@/lib/certificateImage";

// Serves the personalised Good Samaritan Warrior certificate as a PNG.
// Rendered on demand rather than stored: the only inputs are the name and
// the certificate number already fixed on the submission row, so there's
// nothing to keep in sync, and the file is only ever built for someone who
// actually asks for it.
export async function GET(request, { params }) {
  const { id } = await params;
  const submission = getSubmission(id);
  if (!submission) return NextResponse.json({ error: "Submission not found" }, { status: 404 });

  // Re-derived rather than trusted from a query param: the certificate is
  // only issued to a responder whose own answers qualify for it.
  const schema = expandUnitQuestions(getFormSchema(), submission.answers);
  const scored = scoreSubmission(schema, submission.answers);
  if (!scored.qualifiesForCertificate || !submission.certificate_number) {
    return NextResponse.json({ error: "This submission has not earned the certificate." }, { status: 403 });
  }

  const name = `${submission.first_name || ""} ${submission.last_name || ""}`.trim();
  const certificateNumber = formatCertificateNumber(new Date(submission.created_at), submission.certificate_number);
  const png = await renderCertificate({ name, certificateNumber });

  const fileName = `good-samaritan-warrior-${submission.certificate_number}.png`;
  return new NextResponse(png, {
    headers: {
      "Content-Type": "image/png",
      // inline by default so the same URL can back the on-page preview;
      // the download button adds ?download=1 to force a save instead.
      "Content-Disposition": `${request.nextUrl.searchParams.get("download") ? "attachment" : "inline"}; filename="${fileName}"`,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
