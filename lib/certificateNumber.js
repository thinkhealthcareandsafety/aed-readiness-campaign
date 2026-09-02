// Matches the format already printed on the paper Good Samaritan Warrior
// certificate this campaign is digitizing: IAGS-SN/<day>/<month>/<year>/<seq>.
// <seq> is assigned once, in submission order, across every
// certificate-qualifying report ever generated (see migrateCertificateNumbers
// and insertSubmission in lib/db.js) — never recomputed at view time, so a
// certificate's number can't change between visits or after later
// submissions/deletions shift what a live COUNT(*) would return.
export function formatCertificateNumber(date, sequence) {
  const d = String(date.getDate()).padStart(2, "0");
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const y = date.getFullYear();
  const n = String(sequence).padStart(3, "0");
  return `IAGS-SN/${d}/${m}/${y}/${n}`;
}
