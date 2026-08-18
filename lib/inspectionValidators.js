// Plausibility checks for AI-read AED data, ported from the sibling
// aed-inspection-platform project's python-cv/app/utils/validators.py and
// date_parser.py. These don't verify a read is *correct* — only that it
// isn't obvious garbage — before it's allowed to auto-fill a form field.

const SERIAL_MIN_LEN = 4;
const SERIAL_MAX_LEN = 30;
const SERIAL_ALNUM_RE = /[A-Za-z0-9]/;

const ISO_DATE_RE = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/;

// Battery/pad shelf life is a few years; a read outside this window is far
// more likely a misread digit than a genuine label value.
const MIN_PLAUSIBLE_YEAR_OFFSET = -5;
const MAX_PLAUSIBLE_YEAR_OFFSET = 20;

export function isPlausibleSerial(serial) {
  if (!serial) return false;
  const trimmed = serial.trim();
  if (trimmed.length < SERIAL_MIN_LEN || trimmed.length > SERIAL_MAX_LEN) return false;
  return SERIAL_ALNUM_RE.test(trimmed);
}

// Accepts "YYYY-MM" or "YYYY-MM-DD". Checks the month is 1-12, the day (if
// present) is a real day for that month/year, and the year falls in a
// plausible window around today rather than decades off.
export function isPlausibleExpiry(dateStr, today = new Date()) {
  if (!dateStr) return false;
  const match = ISO_DATE_RE.exec(dateStr.trim());
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = match[3] ? Number(match[3]) : null;
  if (month < 1 || month > 12) return false;

  const probe = new Date(Date.UTC(year, month - 1, day ?? 1));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1) return false;
  if (day != null && probe.getUTCDate() !== day) return false;

  const referenceYear = today.getUTCFullYear();
  return year >= referenceYear + MIN_PLAUSIBLE_YEAR_OFFSET && year <= referenceYear + MAX_PLAUSIBLE_YEAR_OFFSET;
}

function toYearMonth(dateStr) {
  const match = ISO_DATE_RE.exec(dateStr.trim());
  if (!match) return null;
  return `${match[1]}-${match[2]}`;
}

// Independently re-derives a date from the raw label text Gemini
// transcribed and compares it against Gemini's own normalised value, as a
// second opinion unrelated to whatever reasoning Gemini used. Returns true
// (agrees / nothing to cross-check) whenever there's nothing to compare
// against; only false on an *active* disagreement between the two reads.
export function expiryCrossCheckAgrees(geminiNormalised, rawLabelText) {
  if (!geminiNormalised || !rawLabelText) return true;

  const parsed = parseExpiryDate(rawLabelText);
  if (!parsed) return true;

  const geminiYm = toYearMonth(geminiNormalised);
  const parsedYm = toYearMonth(parsed) || parsed;
  if (geminiYm == null) return true;

  return geminiYm === parsedYm;
}

const MONTH_ABBR = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

// Ordered list of patterns, most-specific first. Full Y-M-D / M-D-Y dates
// MUST be tried before the bare Y-M / M-Y patterns below, otherwise the
// shorter pattern matches the leading "2025/06" of "2025/06/15" and the day
// is silently dropped.
const PATTERNS = [
  { re: /\b(20\d{2})[-/.](0[1-9]|1[0-2])[-/.](\d{1,2})\b/, fmt: "ymd" },
  { re: /\b(0[1-9]|1[0-2])[-/.](\d{1,2})[-/.](20\d{2})\b/, fmt: "mdy" },
  { re: /\b(20\d{2})[-/.](0[1-9]|1[0-2])\b/, fmt: "ym" },
  { re: /\b(0[1-9]|1[0-2])[-/.](20\d{2})\b/, fmt: "my" },
  { re: /\b([A-Za-z]{3})[-/ ]*(20\d{2})\b/, fmt: "bY" },
  { re: /use\s+by\s+(20\d{2})[-/.](0[1-9]|1[0-2])/i, fmt: "ym" },
  { re: /exp[:\s]*(20\d{2})[-/.](0[1-9]|1[0-2])/i, fmt: "ym" },
];

// Extract and normalise an expiry date from OCR/label text. Returns an ISO
// "YYYY-MM" or "YYYY-MM-DD" string, or null.
export function parseExpiryDate(text) {
  if (!text) return null;
  const trimmed = text.trim();

  for (const { re, fmt } of PATTERNS) {
    const match = re.exec(trimmed);
    if (!match) continue;

    try {
      if (fmt === "ym" || fmt === "my") {
        const year = Number(fmt === "ym" ? match[1] : match[2]);
        const month = Number(fmt === "ym" ? match[2] : match[1]);
        return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
      }
      if (fmt === "bY") {
        const month = MONTH_ABBR[match[1].toLowerCase().slice(0, 3)];
        if (!month) continue;
        const year = Number(match[2]);
        return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
      }
      if (fmt === "ymd") {
        const [, y, m, d] = match;
        return `${String(Number(y)).padStart(4, "0")}-${String(Number(m)).padStart(2, "0")}-${String(Number(d)).padStart(2, "0")}`;
      }
      if (fmt === "mdy") {
        const [, m, d, y] = match;
        return `${String(Number(y)).padStart(4, "0")}-${String(Number(m)).padStart(2, "0")}-${String(Number(d)).padStart(2, "0")}`;
      }
    } catch {
      continue;
    }
  }
  return null;
}
