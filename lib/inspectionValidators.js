// Plausibility checks and date parsing for AI-read AED labels, ported from
// the sibling aed-inspection-platform project's python-cv/app/utils
// (validators.py and date_parser.py). These don't verify a read is
// *correct* — only that it isn't obvious garbage — before it's allowed to
// auto-fill a form field.

const ISO_DATE_RE = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/;

// How far from today an expiry date can be and still be believed.
// Backwards: far. A neglected AED with pads that ran out years ago is exactly
// what an audit exists to find — a narrow window told pads that expired in
// 2019 their photo "looked implausible" instead of telling the hotel to
// replace them. Forwards: near. No AED pads or battery is sold with more than
// about five years of life, so a date further out is a misread digit (an 8
// for a 3), and believing it would pass a dead consumable.
const MIN_PLAUSIBLE_YEAR_OFFSET = -20;
const MAX_PLAUSIBLE_YEAR_OFFSET = 8;

// Accepts "YYYY-MM" or "YYYY-MM-DD". Checks the month is 1-12, the day (if
// present) is a real day for that month/year, and the year falls in a
// plausible window around today rather than decades off.
export function isPlausibleExpiry(dateStr, today = new Date()) {
  if (!dateStr) return false;
  const match = ISO_DATE_RE.exec(String(dateStr).trim());
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
  const match = ISO_DATE_RE.exec(String(dateStr).trim());
  return match ? `${match[1]}-${match[2]}` : null;
}

// Independently re-derives the dates from the raw label text Gemini
// transcribed and checks Gemini's chosen value is among them — a second
// opinion unrelated to whatever reasoning Gemini used. The transcription
// lists every date on the label (manufacture as well as expiry), so
// agreement means the chosen date appears among them, not that it happens
// to be the first one written down. Returns true whenever there's nothing to
// compare against; only false on an *active* disagreement.
export function expiryCrossCheckAgrees(geminiNormalised, rawLabelText) {
  if (!geminiNormalised || !rawLabelText) return true;
  const parsedAll = parseAllExpiryDates(rawLabelText);
  if (!parsedAll.length) return true;
  const geminiYm = toYearMonth(geminiNormalised);
  if (geminiYm == null) return true;
  return parsedAll.some((p) => (toYearMonth(p) || p) === geminiYm);
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
  { source: String.raw`\b(20\d{2})[-/.](0[1-9]|1[0-2])[-/.](\d{1,2})\b`, fmt: "ymd" },
  { source: String.raw`\b(0[1-9]|1[0-2])[-/.](\d{1,2})[-/.](20\d{2})\b`, fmt: "mdy" },
  { source: String.raw`\b(20\d{2})[-/.](0[1-9]|1[0-2])\b`, fmt: "ym" },
  { source: String.raw`\b(0[1-9]|1[0-2])[-/.](20\d{2})\b`, fmt: "my" },
  { source: String.raw`\b([A-Za-z]{3})[-/ ]*(20\d{2})\b`, fmt: "bY" },
  { source: String.raw`use\s+by\s+(20\d{2})[-/.](0[1-9]|1[0-2])`, fmt: "ym" },
  { source: String.raw`exp[:\s]*(20\d{2})[-/.](0[1-9]|1[0-2])`, fmt: "ym" },
];

const pad = (n, width = 2) => String(n).padStart(width, "0");

function normaliseMatch(match, fmt) {
  if (fmt === "ym" || fmt === "my") {
    const year = Number(fmt === "ym" ? match[1] : match[2]);
    const month = Number(fmt === "ym" ? match[2] : match[1]);
    return `${pad(year, 4)}-${pad(month)}`;
  }
  if (fmt === "bY") {
    const month = MONTH_ABBR[match[1].toLowerCase().slice(0, 3)];
    if (!month) return null;
    return `${pad(Number(match[2]), 4)}-${pad(month)}`;
  }
  if (fmt === "ymd") return `${pad(Number(match[1]), 4)}-${pad(Number(match[2]))}-${pad(Number(match[3]))}`;
  if (fmt === "mdy") return `${pad(Number(match[3]), 4)}-${pad(Number(match[1]))}-${pad(Number(match[2]))}`;
  return null;
}

// Extract and normalise the first date in OCR/label text. Returns an ISO
// "YYYY-MM" or "YYYY-MM-DD" string, or null.
export function parseExpiryDate(text) {
  if (!text) return null;
  const trimmed = String(text).trim();
  for (const { source, fmt } of PATTERNS) {
    const match = new RegExp(source, "i").exec(trimmed);
    if (!match) continue;
    const value = normaliseMatch(match, fmt);
    if (value) return value;
  }
  return null;
}

// GS1 human-readable element strings, as printed under barcodes on pads
// boxes and device labels: "(17)221228" is the expiry and "(11)230301" the
// production date, both YYMMDD. "(15)" is the best-before date. A day of
// "00" means the end of that month. Unlike a printed date, a GS1 field says
// unambiguously what it is.
const GS1_DATE_SOURCE = String.raw`\((1[157])\)\s?(\d{2})(\d{2})(\d{2})`;

// { "17": expiry, "15": best-before, "11": production } from GS1 text,
// normalised like the other parsers.
export function parseGs1Dates(text) {
  const found = {};
  if (!text) return found;
  for (const match of String(text).matchAll(new RegExp(GS1_DATE_SOURCE, "g"))) {
    const [, code, yy, mm, dd] = match;
    const month = Number(mm);
    if (month < 1 || month > 12) continue;
    const year = 2000 + Number(yy);
    let value;
    if (dd === "00") {
      value = `${year}-${mm}`;
    } else {
      const probe = new Date(Date.UTC(year, month - 1, Number(dd)));
      if (probe.getUTCMonth() !== month - 1) continue;
      value = `${year}-${mm}-${dd}`;
    }
    if (!(code in found)) found[code] = value;
  }
  return found;
}

// Every date in `text`, normalised, in the order they appear. Labels carry
// several dates (manufacture, install-before, use-by); anything comparing
// against the raw text must consider every one of them, not just the first —
// on a Philips battery the first is the manufacture date.
export function parseAllExpiryDates(text) {
  if (!text) return [];
  const str = String(text);
  const found = [];
  const claimed = [];
  for (const { source, fmt } of PATTERNS) {
    for (const match of str.matchAll(new RegExp(source, "gi"))) {
      const start = match.index;
      const end = start + match[0].length;
      // A span already claimed by a more specific pattern (a full Y-M-D)
      // must not be re-read by a shorter one (its leading Y-M).
      if (claimed.some(([s, e]) => start < e && s < end)) continue;
      const value = normaliseMatch(match, fmt);
      if (value) {
        claimed.push([start, end]);
        found.push([start, value]);
      }
    }
  }
  // GS1 fields have no separators, so the patterns above never see them.
  for (const match of str.matchAll(new RegExp(GS1_DATE_SOURCE, "g"))) {
    for (const value of Object.values(parseGs1Dates(match[0]))) found.push([match.index, value]);
  }
  found.sort((a, b) => a[0] - b[0]);
  return [...new Set(found.map(([, v]) => v))];
}

// The last day (UTC midnight) on which a consumable with this expiry may
// still be used. A label printed "YYYY-MM" means usable THROUGH that month,
// so a month-only expiry resolves to the month's final day — not the first,
// which would fail pads on 1 September that are good until the 30th.
export function expiryLastValidDay(dateStr) {
  if (!dateStr) return null;
  const match = ISO_DATE_RE.exec(String(dateStr).trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  if (!match[3]) return new Date(Date.UTC(year, month, 0));
  const day = Number(match[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCMonth() === month - 1 ? probe : null;
}

// "YYYY-MM" or "YYYY-MM-DD" moved on by whole months, at the same
// precision. A day the target month lacks (29 Feb) falls to its last day.
export function addMonths(value, months) {
  const match = ISO_DATE_RE.exec(String(value || "").trim());
  if (!match) return null;
  const total = Number(match[1]) * 12 + (Number(match[2]) - 1) + months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  if (!match[3]) return `${pad(year, 4)}-${pad(month)}`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${pad(year, 4)}-${pad(month)}-${pad(Math.min(Number(match[3]), lastDay))}`;
}

// Today's date at UTC midnight, the reference every expiry is judged on.
export function utcToday(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}
