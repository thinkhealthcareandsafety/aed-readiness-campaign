// Decodes a manufacture date from an AED's own serial number, for the
// handful of brands that actually encode one in a documented, verified
// format. This is deliberately narrow: getting this wrong would mean
// telling a hotel their life-saving equipment is fine when it isn't, or
// telling them a perfectly good unit needs replacing — worse than showing
// nothing, so a model with no independently-verified format returns null
// rather than guessing at a pattern.
//
// Verified formats (checked against manufacturer documentation and real
// examples, not guessed):
//   - Philips HeartStart HS1:  A[YY][month letter]-XXXXX   e.g. A20L-03190 -> Dec 2020
//   - Philips HeartStart FRx:  B[YY][month letter]-XXXXX   e.g. B17C-00516 -> Mar 2017
//   - ZOLL AED Plus:           X[YY][month letter][digits] e.g. X12B123456 -> Feb 2012
//   Month letter: A=Jan, B=Feb, C=Mar, D=Apr, E=May, F=Jun, G=Jul, H=Aug,
//   I=Sep, J=Oct, K=Nov, L=Dec (skips "I" is NOT skipped here — all three
//   sources agree the sequence runs A-L straight through with no letters
//   omitted).
// Cardiac Science G5, Defibtech, and Physio-Control CR Plus/LP1000 have no
// consistently-documented serial-to-date scheme across sources — omitted
// on purpose rather than guessed.
const MONTH_LETTERS = "ABCDEFGHIJKL";

const DECODERS = {
  hs1: /^A(\d{2})([A-L])-?\d+/,
  frx: /^B(\d{2})([A-L])-?\d+/,
  zollPlus: /^X(\d{2})([A-L])\d+/,
};

export function decodeAedManufactureDate(model, serial) {
  const pattern = DECODERS[model];
  if (!pattern || !serial) return null;
  const match = pattern.exec(String(serial).trim().toUpperCase());
  if (!match) return null;
  const year = 2000 + parseInt(match[1], 10); // none of these product lines shipped before 2000
  const month = MONTH_LETTERS.indexOf(match[2]) + 1; // 1-12
  return { year, month };
}

// Company policy: 5 years from manufacture.
const DEVICE_AGE_WARNING_YEARS = 5;

export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function aedAgeWarning(model, serial, today = new Date()) {
  const decoded = decodeAedManufactureDate(model, serial);
  if (!decoded) return null;
  const manufactureDate = new Date(decoded.year, decoded.month - 1, 1);
  if (manufactureDate > today) return null; // implausible future date — decode almost certainly wrong, say nothing
  const ageYears = (today - manufactureDate) / (365.25 * 24 * 60 * 60 * 1000);
  if (ageYears < DEVICE_AGE_WARNING_YEARS) return null;
  return { year: decoded.year, month: decoded.month, ageYears: Math.floor(ageYears) };
}
