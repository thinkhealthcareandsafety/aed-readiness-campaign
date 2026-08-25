// Country dial-code picker for the phone field. This campaign is
// India-first (see the strict digit rules below), but auditors sometimes
// register from outside India, so a hardcoded "+91" was too rigid. This is
// a deliberately curated list of the markets this campaign actually
// touches or is likely to, not the full 200+ entry ITU table — adding a
// missing country later is a one-line addition here, not a schema change,
// since the phone answer is always stored as a single self-describing
// "+<dial><localDigits>" string (see composePhoneValue/parsePhoneValue).
export const COUNTRY_CODES = [
  { iso: "IN", name: "India", dial: "91", minDigits: 10, maxDigits: 10 },
  { iso: "US", name: "United States", dial: "1", minDigits: 10, maxDigits: 10 },
  { iso: "CA", name: "Canada", dial: "1", minDigits: 10, maxDigits: 10 },
  { iso: "GB", name: "United Kingdom", dial: "44", minDigits: 10, maxDigits: 10 },
  { iso: "AE", name: "United Arab Emirates", dial: "971", minDigits: 8, maxDigits: 9 },
  { iso: "SA", name: "Saudi Arabia", dial: "966", minDigits: 9, maxDigits: 9 },
  { iso: "QA", name: "Qatar", dial: "974", minDigits: 8, maxDigits: 8 },
  { iso: "KW", name: "Kuwait", dial: "965", minDigits: 8, maxDigits: 8 },
  { iso: "OM", name: "Oman", dial: "968", minDigits: 8, maxDigits: 8 },
  { iso: "BH", name: "Bahrain", dial: "973", minDigits: 8, maxDigits: 8 },
  { iso: "SG", name: "Singapore", dial: "65", minDigits: 8, maxDigits: 8 },
  { iso: "MY", name: "Malaysia", dial: "60", minDigits: 9, maxDigits: 10 },
  { iso: "TH", name: "Thailand", dial: "66", minDigits: 9, maxDigits: 9 },
  { iso: "ID", name: "Indonesia", dial: "62", minDigits: 9, maxDigits: 12 },
  { iso: "PH", name: "Philippines", dial: "63", minDigits: 10, maxDigits: 10 },
  { iso: "LK", name: "Sri Lanka", dial: "94", minDigits: 9, maxDigits: 9 },
  { iso: "NP", name: "Nepal", dial: "977", minDigits: 10, maxDigits: 10 },
  { iso: "BD", name: "Bangladesh", dial: "880", minDigits: 10, maxDigits: 10 },
  { iso: "PK", name: "Pakistan", dial: "92", minDigits: 10, maxDigits: 10 },
  { iso: "AU", name: "Australia", dial: "61", minDigits: 9, maxDigits: 9 },
  { iso: "NZ", name: "New Zealand", dial: "64", minDigits: 8, maxDigits: 9 },
  { iso: "DE", name: "Germany", dial: "49", minDigits: 10, maxDigits: 11 },
  { iso: "FR", name: "France", dial: "33", minDigits: 9, maxDigits: 9 },
  { iso: "ZA", name: "South Africa", dial: "27", minDigits: 9, maxDigits: 9 },
  { iso: "KE", name: "Kenya", dial: "254", minDigits: 9, maxDigits: 9 },
  { iso: "JP", name: "Japan", dial: "81", minDigits: 10, maxDigits: 10 },
  { iso: "CN", name: "China", dial: "86", minDigits: 11, maxDigits: 11 },
  { iso: "HK", name: "Hong Kong", dial: "852", minDigits: 8, maxDigits: 8 },
];

export const DEFAULT_COUNTRY_ISO = "IN";

export function countryByIso(iso) {
  return COUNTRY_CODES.find((c) => c.iso === iso) || countryByIso(DEFAULT_COUNTRY_ISO);
}

// The handful of "technically the right length" numbers responders reach
// for when they don't want to give a real one. Checked for every country,
// not just India — "1111111111" is exactly as fake dialed from the US.
function isRepeatedOrObviousJunk(digits) {
  if (/^(\d)\1+$/.test(digits)) return true; // 0000000000, 9999999999...
  if (digits === "1234567890" || digits === "0123456789") return true;
  return false;
}

// India-specific real-network-format check (matches the original
// isValidIndianMobile behavior): exactly 10 digits, starting 6-9.
const INDIA_FAKE_PATTERNS = new Set(["9876543210", "9123456780"]);

function isValidLocalDigitsForCountry(country, digits) {
  if (digits.length < country.minDigits || digits.length > country.maxDigits) return false;
  if (isRepeatedOrObviousJunk(digits)) return false;
  if (country.iso === "IN") {
    if (!/^[6-9]\d{9}$/.test(digits)) return false;
    if (INDIA_FAKE_PATTERNS.has(digits)) return false;
  }
  return true;
}

// The phone answer is always stored as "+<dial><localDigits>" (composed by
// the country-code picker in AuditWizard.jsx), so validation and any later
// consumer (admin CSV, report page) can read the country straight back out
// of the value with no separate DB column. Matches the longest dial code
// first so "+1..." isn't mis-split against a shorter code that happens to
// prefix a longer one.
export function parsePhoneValue(value) {
  const digits = String(value || "").replace(/\D/g, "");
  const byLongestDial = [...COUNTRY_CODES].sort((a, b) => b.dial.length - a.dial.length);
  for (const country of byLongestDial) {
    if (digits.startsWith(country.dial)) {
      const local = digits.slice(country.dial.length);
      if (local.length === 0) continue;
      return { country, digits: local };
    }
  }
  return null;
}

export function composePhoneValue(iso, localDigits) {
  const country = countryByIso(iso);
  return `+${country.dial}${localDigits}`;
}

// Same as parsePhoneValue, but also accepts a bare local number with no
// dial-code prefix at all — the shape every phone answer had before the
// country picker existed (both older submissions and same-session drafts
// saved seconds before this shipped). Treated as India, since that was the
// only option those older answers could ever have meant.
export function parsePhoneValueLenient(value) {
  const parsed = parsePhoneValue(value);
  if (parsed) return parsed;
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length < 6) return null;
  const india = countryByIso(DEFAULT_COUNTRY_ISO);
  return { country: india, digits: sanitizeLocalDigits(india.iso, digits) };
}

// Lenient on read (accepts both the current "+<dial><digits>" shape and a
// bare legacy 10-digit value with no prefix at all, treated as India) so an
// answer saved by an older build of this form — or a same-session draft
// from seconds before this shipped — doesn't suddenly fail re-validation
// just because nobody happened to re-type it. New/edited values are always
// written in the composed form regardless (see composePhoneValue).
export function isValidInternationalPhone(value) {
  const parsed = parsePhoneValueLenient(value);
  if (!parsed) return false;
  return isValidLocalDigitsForCountry(parsed.country, parsed.digits);
}

// Normalizes free-typed/pasted local-number input as the responder types:
// strips everything but digits, and if they paste the dial code again on
// top of having already picked the country (e.g. "+91 98765 43210" into a
// field that already shows "+91"), strips the duplicate so it doesn't just
// get rejected as too long.
export function sanitizeLocalDigits(iso, raw) {
  const country = countryByIso(iso);
  let digits = String(raw || "").replace(/\D/g, "");
  if (digits.length > country.maxDigits && digits.startsWith(country.dial)) {
    digits = digits.slice(country.dial.length);
  } else if (country.iso === "IN" && digits.length === 11 && digits.startsWith("0")) {
    digits = digits.slice(1);
  }
  return digits.slice(0, country.maxDigits);
}
