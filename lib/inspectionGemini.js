// Gemini vision call for one auto-inspection checklist item — ported from
// the sibling aed-inspection-platform project's
// python-cv/app/services/gemini_checklist_service.py. One multimodal call
// per uploaded photo (or per browser-extracted frame sequence for the
// video item), returning a single structured verdict.
import { GoogleGenAI, Type } from "@google/genai";
import { getChecklistItem } from "./inspectionChecklist";
import { isPlausibleSerial, isPlausibleExpiry, expiryCrossCheckAgrees, parseExpiryDate } from "./inspectionValidators";

// Flash-lite is enough for a single still photo; the readiness-indicator
// item (a short frame sequence) benefits from the stronger reasoning of the
// full flash model when judging a sequence of frames.
const GEMINI_IMAGE_MODEL = "gemini-3.1-flash-lite";
const GEMINI_VIDEO_MODEL = "gemini-3.5-flash";

const REQUEST_TIMEOUT_MS = 40_000;

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

function buildPrompt(item, frameCount) {
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
    "item and must return a single structured verdict.\n\n" +
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

/**
 * @param {string} itemId
 * @param {{ base64: string, mimeType: string }[]} media one entry for a
 *   photo item, several chronological frames for the video item
 */
export async function analyzeChecklistItem(itemId, media) {
  const item = getChecklistItem(itemId);
  if (!item) throw new Error(`Unknown checklist item: ${itemId}`);
  if (!media?.length) throw new Error("No media provided");

  const isSequence = media.length > 1;
  const model = item.mediaType === "video" ? GEMINI_VIDEO_MODEL : GEMINI_IMAGE_MODEL;
  const parts = [
    ...media.map((m) => ({ inlineData: { mimeType: m.mimeType, data: m.base64 } })),
    { text: buildPrompt(item, isSequence ? media.length : undefined) },
  ];

  const client = getClient();
  const response = await withTimeout(
    client.models.generateContent({
      model,
      contents: [{ role: "user", parts }],
      config: {
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
        temperature: 0.1,
      },
    }),
    REQUEST_TIMEOUT_MS,
    `Gemini call for checklist item=${itemId} exceeded ${REQUEST_TIMEOUT_MS / 1000}s`
  );

  const result = JSON.parse(response.text);
  return applyDeterministicChecks(item, result);
}

// Downgrades an implausible read the same way the ported service did —
// cheap, deterministic sanity checks independent of Gemini's own confidence
// score. Never upgrades a result, only vetoes bad ones.
function applyDeterministicChecks(item, result) {
  if (item.id === "serial_number_1" && result.serial_number) {
    if (!isPlausibleSerial(result.serial_number)) {
      return {
        ...result,
        passed: false,
        serial_number: null,
        notes: "Serial number reading looked implausible — please recapture with the label centred and in focus.",
      };
    }
  }

  if ((item.id === "pads_expiry_date_1" || item.id === "battery_expiry_date_1") && result.expiry_date) {
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
