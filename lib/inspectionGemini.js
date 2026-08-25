// Gemini vision call for one auto-inspection checklist item — ported from
// the sibling aed-inspection-platform project's
// python-cv/app/services/gemini_checklist_service.py. One multimodal call
// per uploaded photo (or per browser-extracted frame sequence for the
// video item), returning a single structured verdict.
import { GoogleGenAI, Type } from "@google/genai";
import { getChecklistItem, modelContextFor } from "./inspectionChecklist";
import { isPlausibleSerial, isPlausibleExpiry, expiryCrossCheckAgrees, parseExpiryDate } from "./inspectionValidators";

// Flash-lite is enough for a single still photo; the readiness-indicator
// item (a short frame sequence) benefits from the stronger reasoning of the
// full flash model when judging a sequence of frames.
const GEMINI_IMAGE_MODEL = "gemini-3.1-flash-lite";
const GEMINI_VIDEO_MODEL = "gemini-3.5-flash";

// The image items return in ~1-2s, so 25s is already generous headroom.
// The video item is a genuinely different story: measured directly against
// the live API, 12-frame calls to gemini-3.5-flash took 26s-50s across
// repeated real trials — the previous single 40s timeout for both was
// killing legitimate, still-in-progress video calls right before they
// would have succeeded (confirmed by re-running the exact same call
// outside the timeout and watching it return 200 at 47-50s). This isn't a
// quota/billing problem; it's this app's own timeout being tighter than
// the model's real latency for a 12-image request.
const REQUEST_TIMEOUT_MS_BY_MODEL = {
  "gemini-3.1-flash-lite": 25_000,
  "gemini-3.5-flash": 75_000,
};
const DEFAULT_REQUEST_TIMEOUT_MS = 75_000;

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    passed: { type: Type.BOOLEAN },
    confidence: { type: Type.NUMBER },
    notes: { type: Type.STRING },
    serial_number: { type: Type.STRING, nullable: true },
    expiry_date: { type: Type.STRING, nullable: true },
    expiry_raw_text: { type: Type.STRING, nullable: true },
    status: { type: Type.STRING, nullable: true },
  },
  required: ["passed", "confidence", "notes"],
};

let _client = null;
function getClient() {
  if (!_client) {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY is not configured");
    }
    _client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return _client;
}

function buildPrompt(item, model, frameCount) {
  const sequenceNote = frameCount
    ? `You are given ${frameCount} still frames extracted evenly across ` +
      "a short video clip, in strict chronological order (the first " +
      "image is the start of the clip, the last is the end). Treat " +
      "them as one continuous observation of the same scene over " +
      "time, not as separate unrelated photos — a change that " +
      "appears in only one or two of the frames (e.g. a light " +
      "turning on then off again) is exactly the kind of brief event " +
      "you are looking for, not noise to discard.\n\n"
    : "";
  return (
    "You are the vision engine for an AED (defibrillator) inspection " +
    "checklist app. You receive photo(s) for exactly one checklist " +
    "item, for one specific physical AED unit, and must return a single " +
    "structured verdict.\n\n" +
    `${modelContextFor(model)}\n\n` +
    sequenceNote +
    `Checklist item: ${item.title}\n` +
    `Task: ${item.prompt}\n\n` +
    "Always set confidence (0.0-1.0) to your own honest certainty in " +
    "this specific media — a blurry, distant, dark, or ambiguous capture " +
    "should score low even if you still produced a best-effort answer. " +
    "notes is one short, friendly sentence: if passed=false, tell the " +
    "inspector exactly what to fix or recapture; if passed=true, briefly " +
    "confirm what you saw. Leave any data field you cannot determine as " +
    "null — never guess."
  );
}

function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Retries only the failure modes that are actually transient — a burst of
// concurrent auto-scans (the whole point of sending this link to 100
// clients at once) is exactly what trips Gemini's own rate limit, and
// without this, that shows up to the end user as a flat "AI analysis
// failed" with no recovery. A malformed request or an unplausible read
// isn't going to succeed on attempt 2, so those still fail immediately.
const RETRYABLE_STATUS = new Set([429, 503]);
function isRetryable(err) {
  const status = err?.status ?? err?.code;
  if (typeof status === "number" && RETRYABLE_STATUS.has(status)) return true;
  const msg = String(err?.message || "");
  return /\b429\b|\b503\b|RESOURCE_EXHAUSTED|UNAVAILABLE|overloaded|rate.?limit/i.test(msg);
}

async function withRetry(fn, attempts = 3) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i === attempts - 1 || !isRetryable(err)) throw err;
      const backoffMs = 600 * 2 ** i + Math.random() * 300; // ~600ms, ~1.5s + jitter
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }
  throw lastErr;
}

/**
 * @param {string} itemId
 * @param {{ base64: string, mimeType: string }[]} media one entry for a
 *   photo item, several chronological frames for the video item
 * @param {string|null} aedModel the value from the "Select your AED
 *   model(s)" question (e.g. "frx", "zollPlus") for the specific unit this
 *   capture is for — null/unrecognized falls back to generic guidance
 *   rather than assuming a Philips FRx, which the previous single-unit
 *   version did unconditionally.
 */
export async function analyzeChecklistItem(itemId, media, aedModel) {
  const item = getChecklistItem(itemId);
  if (!item) throw new Error(`Unknown checklist item: ${itemId}`);
  if (!media?.length) throw new Error("No media provided");

  const isSequence = media.length > 1;
  const geminiModel = item.mediaType === "video" ? GEMINI_VIDEO_MODEL : GEMINI_IMAGE_MODEL;
  const parts = [
    ...media.map((m) => ({ inlineData: { mimeType: m.mimeType, data: m.base64 } })),
    { text: buildPrompt(item, aedModel, isSequence ? media.length : undefined) },
  ];

  const client = getClient();
  const timeoutMs = REQUEST_TIMEOUT_MS_BY_MODEL[geminiModel] ?? DEFAULT_REQUEST_TIMEOUT_MS;
  // Each retry attempt gets its own fresh timeout race — a slow attempt
  // shouldn't eat into the next attempt's budget, and a timeout itself
  // isn't retried (see isRetryable) so this never turns into an unbounded
  // wait for a single user-facing capture.
  const response = await withRetry(() =>
    withTimeout(
      client.models.generateContent({
        model: geminiModel,
        contents: [{ role: "user", parts }],
        config: {
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA,
          temperature: 0.1,
        },
      }),
      timeoutMs,
      `Gemini call for checklist item=${itemId} exceeded ${timeoutMs / 1000}s`
    )
  );

  const result = JSON.parse(response.text);
  return applyDeterministicChecks(item, result);
}

// Downgrades an implausible read the same way the ported service did —
// cheap, deterministic sanity checks independent of Gemini's own confidence
// score. Never upgrades a result, only vetoes bad ones.
function applyDeterministicChecks(item, result) {
  if ((item.id === "pads_expiry_date" || item.id === "battery_expiry_date") && result.expiry_date) {
    const plausible = isPlausibleExpiry(result.expiry_date);
    const agrees = expiryCrossCheckAgrees(result.expiry_date, result.expiry_raw_text);
    if (!plausible || !agrees) {
      return {
        ...result,
        passed: false,
        expiry_date: null,
        notes: "Expiry date reading looked implausible — please recapture with the label centred, well lit, and in focus.",
      };
    }
    // Keep the deterministic parser's month/day if Gemini normalised to
    // month-only but the raw text had a day — free precision upgrade.
    if (result.expiry_raw_text) {
      const deterministic = parseExpiryDate(result.expiry_raw_text);
      if (deterministic && deterministic.length > result.expiry_date.length) {
        return { ...result, expiry_date: deterministic };
      }
    }
  }

  return result;
}
