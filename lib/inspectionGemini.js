// Gemini vision call for one auto-inspection checklist item, for one
// physical AED unit. Ported from the sibling aed-inspection-platform
// project's python-cv/app/services/gemini_checklist_service.py, which is
// tuned against an evaluation set of real labels and readiness clips. The
// model reports what it sees; this module decides what that means:
//
//   - every device-specific fact comes from the unit's profile
//     (lib/aedDeviceProfiles.js), so no unit is judged by another's layout;
//   - expired or not is decided here against the server's clock, never by
//     the model, which has passed expired pads it thought were in the future;
//   - a manufacture date read as an expiry is refused, and a GS1 barcode
//     date overrides a printed date the model read differently;
//   - a Powerheart G5 battery, which carries no expiry, is dated from when
//     it was made or fitted;
//   - a "ready" must cite the frames that show it, and a unit that proves
//     readiness by blinking must have blinked in the browser's scan of every
//     frame (lib/readinessScan.js);
//   - a photo of a different maker's AED can't pass this unit's check;
//   - labels are read by two models, and a disagreement is a retake;
//   - calls are hedged across a fallback chain of models, inside a budget,
//     with a daily ceiling on spend.
//
// Every verdict carries `meta` (model, instructions version, latency,
// tokens, which rules overruled the model) and is logged, so "why did this
// AED pass?" always has an answer.
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { GoogleGenAI, Type, PartMediaResolutionLevel } from "@google/genai";
import { getChecklistItem } from "./inspectionChecklist";
import { getDeviceProfile } from "./aedDeviceProfiles";
import {
  addMonths,
  expiryCrossCheckAgrees,
  expiryLastValidDay,
  isPlausibleExpiry,
  parseAllExpiryDates,
  parseGs1Dates,
  utcToday,
} from "./inspectionValidators";

// Chosen by the platform's measurements (python-cv/eval, 1 Oct 2026):
// gemini-3.5-flash-lite read 47 label photos with no wrong readings (p95
// 3.6 s) and judged 21/21 readiness clips (p50 3.4 s). The models this
// replaces were slower, and gemini-3.1-flash-lite read in-date pads as
// expired until the date decision was taken away from it. Each list is a
// fallback chain: Google counts quota per model, so a second model is a
// second allowance as well as a second chance.
const IMAGE_MODELS = ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite"];
const VIDEO_MODELS = ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite"];

const RETRY_BACKOFF_MS = [1000, 2500];
const IMAGE_BUDGET_MS = 35_000;
// One readiness clip per unit, and a required check: a longer budget so
// hedged retries can finish.
const VIDEO_BUDGET_MS = 50_000;
// No single call may hold the budget hostage: an overloaded model's refusal
// alone can take 12-16 s to arrive.
const PER_ATTEMPT_TIMEOUT_MS = 18_000;
// How long the first model in a chain runs alone before the next is asked
// too — past the slowest normal answer, so a healthy call isn't paid for
// twice. A failure starts the backup at once anyway.
const IMAGE_HEDGE_MS = 7_000;
const VIDEO_HEDGE_MS = 9_000;

// Labels are read twice, by two different models, and the readings must
// agree: a model reading fine print is occasionally confidently wrong, and
// two models rarely make the same mistake on the same character.
const SECOND_READ_ITEMS = new Set(["pads_expiry_date", "battery_expiry_date"]);
const SECOND_READ_GRACE_MS = 4_000;

// A ceiling on AI calls per day (UTC), so a flood of uploads — a bug, a bot,
// someone looping retakes — can't spend the prepaid credit in an afternoon.
// Raise it in the Render dashboard, no code change.
const DAILY_AI_CALL_LIMIT = Number(process.env.DAILY_AI_CALL_LIMIT) || 2500;
const callsToday = { day: null, count: 0 };

export class DailyLimitReached extends Error {}

function spendCall() {
  const day = new Date().toISOString().slice(0, 10);
  if (callsToday.day !== day) Object.assign(callsToday, { day, count: 0 });
  if (callsToday.count >= DAILY_AI_CALL_LIMIT) {
    log("inspection.daily_limit_reached", { limit: DAILY_AI_CALL_LIMIT });
    throw new DailyLimitReached(`Daily AI call limit of ${DAILY_AI_CALL_LIMIT} reached`);
  }
  callsToday.count += 1;
}

const TEMPERATURE = 0.1;
// Bumped by hand when the shared prompt wording changes; the per-item and
// per-device wording is hashed in automatically (see promptVersion).
const PROMPT_REVISION = "2026-10-10a";

// A clip this long, this steady, holds at least two blinks of any unit that
// blinks when ready (Philips and Defibtech: every few seconds, at most ~5).
const NEVER_BLINKED_SECONDS = 10;
const NEVER_BLINKED_STEADY = 0.8;

// Readiness frames at full detail cost ~1,100 tokens each; only the frames
// that decide it need that. Those where the scan saw the light switch on, or,
// with no blink found, a few spread through the clip. The rest show the
// light's state over time and go at low detail (~280).
const DETAILED_WITHOUT_FLASH = 4;

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    passed: { type: Type.BOOLEAN },
    confidence: { type: Type.NUMBER },
    notes: { type: Type.STRING },
    expiry_date: { type: Type.STRING, nullable: true },
    expiry_raw_text: { type: Type.STRING, nullable: true },
    // Captured so the manufacture date can never be mistaken for the expiry:
    // a Philips battery label carries both.
    manufacture_date: { type: Type.STRING, nullable: true },
    // A date someone wrote on the battery when fitting it. Read only where a
    // battery carries no expiry of its own (Powerheart G5).
    install_date: { type: Type.STRING, nullable: true },
    // Expiry items: the model reports what it saw and the server decides.
    date_legible: { type: Type.BOOLEAN, nullable: true },
    damage_seen: { type: Type.BOOLEAN, nullable: true },
    // The brand of AED the model can see — see differentBrand.
    brand_seen: { type: Type.STRING, nullable: true },
    status: { type: Type.STRING, nullable: true }, // readiness only: ready | fault | unclear
    // Readiness only: the numbered frames in which the ready signal is
    // visible. A "ready" with none is not accepted — see checkReadiness.
    ready_frames: { type: Type.ARRAY, items: { type: Type.INTEGER }, nullable: true },
    // Readiness only: the place this unit's indicator sits is clearly in
    // frame — lit or not. An unlit light gives the model nothing to point
    // at, so it used to call a dead unit "unclear"; this asks the one thing
    // it can always answer.
    indicator_in_view: { type: Type.BOOLEAN, nullable: true },
    // Readiness only: the sharpest frame showing the evidence, saved as the
    // audit's visual record when no ready frame is cited.
    key_frame_index: { type: Type.INTEGER, nullable: true },
  },
  required: ["passed", "confidence", "notes"],
};

const OVERRIDE_NOTES = {
  manufactureAsExpiry:
    "That date is the manufacture date, not the expiry date. Look for the date marked 'Install before' or with " +
    "an hourglass symbol and photograph that part of the label.",
  implausibleExpiry:
    "Expiry date reading looked implausible — please recapture with the label centred, well lit, and in focus.",
  readsDisagree: "We couldn't read the expiry date with certainty. Retake it closer, holding steady, in good light.",
  batteryMadeUnread:
    "We couldn't read the date on the battery. This battery shows only the date it was made, beside the " +
    "factory symbol — photograph that part of its label, close and in focus.",
  noExplanation: "AI did not explain this result — please verify it yourself.",
};

// Spelled out rather than left to the server's locale data, which prints
// September as "Sep" on one Node build and "Sept" on another.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtDay = (d) => `${String(d.getUTCDate()).padStart(2, "0")} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
const fmtMonth = (value) => {
  const d = expiryLastValidDay(value);
  return value.length === 7 ? `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}` : fmtDay(d);
};
const daysBetween = (a, b) => Math.round((b - a) / 86_400_000);

function expiredNotes(itemId, lastValid) {
  const what = itemId === "pads_expiry_date" ? "pads" : "battery";
  return `The ${what} expired on ${fmtDay(lastValid)}. Replace the ${what} before this AED is relied on in an emergency.`;
}

// The verdict on an in-date consumable, written here so it can never
// contradict the date (the model has called pads in date until next month
// "expired").
function inDateNotes(itemId, lastValid, today) {
  const pads = itemId === "pads_expiry_date";
  const soon = daysBetween(today, lastValid) <= 90;
  return (
    `${pads ? "Pads" : "Battery"} in date until ${fmtDay(lastValid)}.` +
    (soon ? ` That's within three months — order ${pads ? "replacement pads" : "a replacement battery"} soon.` : "")
  );
}

function neverBlinkedNotes(profile, seconds) {
  return (
    `Not ready: the status light did not blink once in ${Math.round(seconds)} seconds of steady video. A ready ` +
    `${profile.name} flashes green every few seconds, so this AED needs attention — most often its battery is ` +
    "flat, missing or not seated. If the light wasn't in view, retake it up close."
  );
}

// Makers of AEDs, by the words a model uses for them, so a photo of one
// maker's unit is recognised whatever it calls it. Anything else (a battery
// brand such as Duracell, a guessed word) is ignored rather than risk
// failing a good photo.
const AED_BRANDS = {
  Philips: ["philips", "heartstart", "laerdal"],
  ZOLL: ["zoll"],
  Mindray: ["mindray", "beneheart"],
  Schiller: ["schiller", "fred easy"],
  HeartSine: ["heartsine", "samaritan"],
  "Physio-Control": ["physio-control", "physio control", "lifepak", "stryker"],
  "Cardiac Science": ["cardiac science", "powerheart"],
  "Nihon Kohden": ["nihon kohden"],
  Defibtech: ["defibtech", "lifeline"],
  "CU Medical": ["cu medical", "i-pad"],
};

function aedBrand(text) {
  if (!text) return null;
  const lowered = String(text).toLowerCase();
  for (const [brand, words] of Object.entries(AED_BRANDS)) {
    if (words.some((w) => lowered.includes(w))) return brand;
  }
  return null;
}

// The brand the photo shows, when it is clearly a different maker's AED
// from the one being inspected; otherwise null.
function differentBrand(result, profile) {
  if (!profile.brand) return null;
  const seen = aedBrand(result.brand_seen);
  if (!seen || seen === profile.brand || (profile.brandAliases || []).includes(seen)) return null;
  return seen;
}

const REFERENCE_DIR = path.join(process.cwd(), "public", "ai-reference");
const referenceCache = new Map();

// This unit's photo with its readiness indicator circled, or null.
function referencePhoto(profile) {
  const name = profile.referencePhoto;
  if (!name) return null;
  if (!referenceCache.has(name)) {
    try {
      referenceCache.set(name, fs.readFileSync(path.join(REFERENCE_DIR, name)).toString("base64"));
    } catch {
      referenceCache.set(name, null);
    }
  }
  return referenceCache.get(name);
}

function detailedFrames(count, flashPositions) {
  if (flashPositions.size) return flashPositions;
  if (count <= DETAILED_WITHOUT_FLASH) return new Set(Array.from({ length: count }, (_, i) => i + 1));
  const step = count / DETAILED_WITHOUT_FLASH;
  return new Set(Array.from({ length: DETAILED_WITHOUT_FLASH }, (_, i) => Math.floor(step * i + step / 2) + 1));
}

function imagePart(base64, mimeType, level) {
  const part = { inlineData: { mimeType, data: base64 } };
  if (level) part.mediaResolution = { level };
  return part;
}

let client = null;
function getClient() {
  if (!client) {
    if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not configured");
    client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return client;
}

function promptVersion(item, profile) {
  const text = [PROMPT_REVISION, item.prompt, profile.name, profile.appearance, profile.guidance?.[item.id] || ""].join("\n");
  return crypto.createHash("sha1").update(text).digest("hex").slice(0, 10);
}

function buildPrompt(item, profile, { frameCount, duration, guided, scanFlashes } = {}) {
  let sequenceNote = "";
  if (frameCount) {
    const clip = duration ? `a ${Math.round(duration)}-second video clip` : "a short video clip";
    sequenceNote =
      `You are given ${frameCount} still frames from ${clip}, in strict chronological order, each preceded by ` +
      "its label (\"Frame 3 — 1.2 s\"). They are not evenly spaced. Treat them as one continuous observation of " +
      "the same scene over time, not as separate photos: a change seen in only one or two frames (a light " +
      "turning on, then off again) is exactly the kind of brief event to look for. Refer to frames by their " +
      "numbers.\n\n";
  }
  if (guided) {
    sequenceNote +=
      "This clip was filmed in the app with a circle drawn at the centre of the picture, and the inspector was " +
      "told to keep this unit's indicator inside it: look for the indicator at or near the centre of the " +
      "frames.\n\n";
  }
  if (scanFlashes != null) {
    // The scan of every frame is reliable about a small light switching on
    // and off; the model is reliable about WHICH light that is.
    sequenceNote += scanFlashes
      ? "An automatic scan of every frame of the clip marked the frames where a small green light switched on " +
        "and off again (\"scan: a small green light switched on here\"). Check in those frames whether that " +
        "light is this unit's readiness indicator (see the reference photo); if it is, list those frames in " +
        "ready_frames.\n\n"
      : "An automatic scan of every frame of the clip found no small light switching on anywhere in it.\n\n";
  }
  const guidance = profile.guidance?.[item.id];
  const deviceNotes = guidance ? `Device notes for this item (${profile.name}):\n${guidance}\n\n` : "";
  return (
    "You are the vision engine for an AED (defibrillator) inspection checklist app. You receive photo(s) for " +
    "exactly one checklist item and must return a single structured verdict.\n\n" +
    // The model has no reliable sense of the current date. The server makes
    // the final expired call regardless; this keeps its notes consistent.
    `Today's date is ${new Date().toISOString().slice(0, 10)}. A date earlier than today is in the past.\n\n` +
    `DEVICE: ${profile.name}. ${profile.appearance} Set brand_seen to the maker's name as printed on the AED ` +
    "itself — not the brand of batteries or other parts inside it — or null if no AED is visible or you can't " +
    "read its maker. Only a name you can actually read in the media counts: never copy it from this DEVICE " +
    "line. If the image clearly shows a different device, say so in notes.\n\n" +
    sequenceNote +
    `Checklist item: ${item.title}\n` +
    `Task: ${item.prompt}\n\n` +
    deviceNotes +
    "Always set confidence (0.0-1.0) to your own honest certainty in this specific media — a blurry, distant, " +
    "dark, or ambiguous capture should score low even if you still produced a best-effort answer. notes is one " +
    "short, friendly sentence: if passed=false, tell the inspector exactly what to fix or recapture; if " +
    "passed=true, briefly confirm what you saw. Leave any data field you cannot determine as null — never guess."
  );
}

function log(event, fields) {
  console.info(JSON.stringify({ event, ...fields }));
}

const sleep = (ms, signal) =>
  new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });

class AttemptTimeout extends Error {}

// (daily, retryAfterMs) from a 429. A per-day refusal won't clear for hours,
// so that model is done for this request; a per-minute one clears in seconds.
function quotaRefusal(err) {
  const message = String(err?.message || "");
  const retry = /"retryDelay"\s*:\s*"([\d.]+)s"/.exec(message);
  return { daily: /PerDay/i.test(message), retryAfterMs: retry ? Number(retry[1]) * 1000 : null };
}

const isServerSide = (err) =>
  err instanceof AttemptTimeout || (typeof err?.status === "number" ? err.status >= 500 : /fetch failed|ECONNRESET|ETIMEDOUT|socket/i.test(String(err?.message)));

/**
 * Hedged calls across a fallback chain: each model gets its own lane,
 * started `hedgeMs` after the one before it (or at once, when the lane
 * before fails), and the first answer wins. Walking the chain in order spent
 * the whole budget on an overloaded model's slow refusals before the healthy
 * one was ever asked.
 */
export async function firstAnswer(models, callOnce, { hedgeMs, budgetMs, itemId }) {
  const stop = new AbortController();
  const wake = models.map(() => {
    let fire;
    const promise = new Promise((resolve) => (fire = resolve));
    return { promise, fire };
  });
  const failOver = (index) => wake[index + 1]?.fire();

  async function lane(index, model) {
    if (index > 0) await Promise.race([wake[index].promise, sleep(index * hedgeMs, stop.signal)]);
    for (let attempt = 1; !stop.signal.aborted; attempt++) {
      if (attempt > 1 || index > 0) log("inspection.gemini_attempt", { item: itemId, model, attempt });
      const attemptAbort = new AbortController();
      const onStop = () => attemptAbort.abort();
      stop.signal.addEventListener("abort", onStop, { once: true });
      const timer = setTimeout(() => attemptAbort.abort(new AttemptTimeout()), PER_ATTEMPT_TIMEOUT_MS);
      try {
        const response = await callOnce(model, attemptAbort.signal);
        return { model, response };
      } catch (err) {
        if (stop.signal.aborted) throw err;
        const cause = attemptAbort.signal.reason instanceof AttemptTimeout ? attemptAbort.signal.reason : err;
        if (cause instanceof DailyLimitReached) throw cause;
        if (isServerSide(cause)) {
          log("inspection.gemini_server_error", { item: itemId, model, attempt, error: String(cause?.message || cause.name) });
          failOver(index);
          await sleep(RETRY_BACKOFF_MS[Math.min(attempt - 1, RETRY_BACKOFF_MS.length - 1)], stop.signal);
          continue;
        }
        if (cause?.status === 429) {
          const { daily, retryAfterMs } = quotaRefusal(cause);
          log("inspection.gemini_quota", { item: itemId, model, daily, retryAfterMs });
          failOver(index);
          if (daily) throw cause;
          await sleep(Math.min(retryAfterMs || 2000, 10_000), stop.signal);
          continue;
        }
        // A 4xx: this lane gives up for good — and the next starts now, not
        // at its hedge time (a withdrawn model answers 404 every time).
        failOver(index);
        throw cause;
      } finally {
        clearTimeout(timer);
        stop.signal.removeEventListener("abort", onStop);
      }
    }
    throw new Error("cancelled");
  }

  let budgetTimer;
  const budget = new Promise((_, reject) => {
    budgetTimer = setTimeout(() => reject(new Error(`Gemini call for checklist item=${itemId} exceeded ${budgetMs / 1000}s`)), budgetMs);
  });
  try {
    return await Promise.race([Promise.any(models.map((m, i) => lane(i, m))), budget]);
  } catch (err) {
    // Promise.any rejects with every lane's error: surface the first real one.
    throw err instanceof AggregateError ? err.errors.find((e) => e?.message !== "cancelled") || err.errors[0] : err;
  } finally {
    clearTimeout(budgetTimer);
    stop.abort();
  }
}

function parseResponse(response) {
  return JSON.parse(response.text);
}

// What a verdict read off the label, in a form two readings can be compared
// in: the expiry's month — or, on a battery dated by its age, the month it
// is dated from.
function reading(item, verdict, profile) {
  const value =
    item.id === "battery_expiry_date" && profile.batteryLifeMonths
      ? verdict.install_date || verdict.manufacture_date || verdict.expiry_date
      : verdict.expiry_date;
  const trimmed = String(value || "").trim();
  return trimmed.length >= 7 ? trimmed.slice(0, 7) : null;
}

// agrees / disagrees / unread. A second model that couldn't read the label
// doesn't contradict one that could — it only fails to confirm.
function compareReadings(item, first, second, profile) {
  const a = reading(item, first, profile);
  const b = reading(item, second, profile);
  if (!a || !b) return "unread";
  return a === b ? "agrees" : "disagrees";
}

/**
 * @param {string} itemId
 * @param {{ base64: string, mimeType: string }[]} media one entry for a
 *   photo item, several chronological frames for the video item
 * @param {string|null} aedModel the model value for this specific unit
 *   ("frx", "g5", …) — null/unknown gets the generic profile
 * @param {{ scan?: { times: number[], flashPositions: number[], flashCount: number,
 *   duration: number, steadyShare: number } | null, guided?: boolean }} [options]
 *   scan: what the browser's scan of every frame of a readiness clip found
 *   (lib/readinessScan.js); null when the browser couldn't scan it.
 */
export async function analyzeChecklistItem(itemId, media, aedModel, { scan = null, guided = false } = {}) {
  const item = getChecklistItem(itemId);
  if (!item) throw new Error(`Unknown checklist item: ${itemId}`);
  if (!media?.length) throw new Error("No media provided");

  const profile = getDeviceProfile(aedModel);
  const isVideo = item.mediaType === "video";
  const models = isVideo ? VIDEO_MODELS : IMAGE_MODELS;

  let parts;
  if (isVideo) {
    parts = [];
    const reference = referencePhoto(profile);
    if (reference) {
      // Where to look, as a person would be shown: this unit's own photo
      // with its light circled. A small dark lens was otherwise "not in
      // view" to the model in a clip that showed it plainly.
      parts.push({
        text:
          `REFERENCE — not from this inspection: a ${profile.name} with its readiness indicator circled in red. ` +
          "Use it only to know where the indicator is on this unit.",
      });
      parts.push(imagePart(reference, "image/jpeg", PartMediaResolutionLevel.MEDIA_RESOLUTION_LOW));
    }
    const flashes = new Set(scan?.flashPositions || []);
    // Without a scan there's nothing to say which frames matter: all go at
    // full detail, so a flash in any of them can still be seen.
    const detailed = scan ? detailedFrames(media.length, flashes) : null;
    media.forEach((m, i) => {
      const number = i + 1;
      const at = scan?.times?.[i];
      const mark = flashes.has(number) ? " · scan: a small green light switched on here" : "";
      parts.push({ text: `Frame ${number}${typeof at === "number" ? ` — ${at.toFixed(1)} s` : ""}${mark}` });
      const level = !detailed || detailed.has(number) ? PartMediaResolutionLevel.MEDIA_RESOLUTION_HIGH : PartMediaResolutionLevel.MEDIA_RESOLUTION_LOW;
      parts.push(imagePart(m.base64, m.mimeType, level));
    });
    parts.push({
      text: buildPrompt(item, profile, {
        frameCount: media.length,
        duration: scan?.duration,
        guided,
        scanFlashes: scan ? flashes.size : null,
      }),
    });
  } else {
    parts = [imagePart(media[0].base64, media[0].mimeType), { text: buildPrompt(item, profile) }];
  }

  const ai = getClient();
  const config = { responseMimeType: "application/json", responseSchema: RESPONSE_SCHEMA, temperature: TEMPERATURE };

  async function callOnce(model, signal) {
    spendCall();
    try {
      return await ai.models.generateContent({ model, contents: [{ role: "user", parts }], config: { ...config, abortSignal: signal } });
    } catch (err) {
      // A model that refuses per-image detail levels still gets the frames,
      // at its default detail, rather than failing the check.
      if (err?.status !== 400 || !parts.some((p) => p.mediaResolution)) throw err;
      log("inspection.media_resolution_refused", { model, error: String(err.message).slice(0, 200) });
      spendCall();
      const plain = parts.map(({ mediaResolution, ...rest }) => rest);
      return await ai.models.generateContent({ model, contents: [{ role: "user", parts: plain }], config: { ...config, abortSignal: signal } });
    }
  }

  const budgetMs = isVideo ? VIDEO_BUDGET_MS : IMAGE_BUDGET_MS;
  const started = Date.now();

  let secondModel = null;
  let second = null;
  const secondAbort = new AbortController();
  if (SECOND_READ_ITEMS.has(item.id)) {
    secondModel = models.find((m) => m !== models[0]) || null;
    if (secondModel) {
      const timer = setTimeout(() => secondAbort.abort(), PER_ATTEMPT_TIMEOUT_MS);
      second = callOnce(secondModel, secondAbort.signal)
        .then(parseResponse)
        .finally(() => clearTimeout(timer));
      second.catch(() => {}); // settled below, or deliberately abandoned
    }
  }

  let winner;
  try {
    winner = await firstAnswer(models, callOnce, { hedgeMs: isVideo ? VIDEO_HEDGE_MS : IMAGE_HEDGE_MS, budgetMs, itemId });
  } catch (err) {
    secondAbort.abort();
    throw err;
  }
  const latencyMs = Date.now() - started;
  let result = parseResponse(winner.response);

  const overrides = [];
  let secondRead = null;
  if (second) {
    const remaining = Math.max(0, budgetMs - (Date.now() - started));
    const grace = Math.min(SECOND_READ_GRACE_MS, remaining);
    try {
      const other = await Promise.race([second, sleep(grace).then(() => Promise.reject(new Error("slow")))]);
      secondRead = compareReadings(item, result, other, profile);
    } catch (err) {
      secondAbort.abort();
      secondRead = "unavailable";
      log("inspection.second_read_unavailable", { item: itemId, model: secondModel, error: String(err?.message || err) });
    }
  }

  if (secondRead === "disagrees") {
    overrides.push("second_read_disagrees");
    log("inspection.readings_disagree", { item: itemId, first: winner.model, second: secondModel });
    result = {
      ...result,
      passed: false,
      expiry_date: null,
      confidence: Math.min(result.confidence ?? 0, 0.4),
      notes: OVERRIDE_NOTES.readsDisagree,
    };
  } else {
    result = applyDeterministicChecks(item, result, { profile, scan, frameCount: media.length, overrides });
  }

  const usage = winner.response.usageMetadata || {};
  const meta = {
    model: winner.model,
    prompt_version: promptVersion(item, profile),
    latency_ms: latencyMs,
    input_tokens: usage.promptTokenCount ?? null,
    output_tokens: usage.candidatesTokenCount ?? null,
    thinking_tokens: usage.thoughtsTokenCount ?? null,
    frames_sent: isVideo ? media.length : null,
    flashes_found: isVideo && scan ? scan.flashCount : null,
    second_model: second ? secondModel : null,
    second_read: secondRead,
    overrides,
  };
  log("inspection.verdict", { item: itemId, profile: profile.id, passed: result.passed, status: result.status ?? null, ...meta });
  return { ...result, meta };
}

/**
 * A readiness pass has to be backed by something checkable.
 *
 * - The model must name the frames in which it sees the ready signal. A
 *   "ready" it can't point to is not accepted.
 * - A unit that proves readiness by blinking must also have blinked: if the
 *   scan of every frame found no flash at all, no reading of the frames can
 *   pass it. If the clip was long and steady enough that a blink could not
 *   have been missed, the unit is not ready (a fault); otherwise it's a
 *   retake.
 * - passed follows status, never the other way round.
 * It only ever turns a pass into "unclear" (a retake, saying exactly what to
 * film) or "fault", and never turns a fail into a pass.
 */
function checkReadiness(result, profile, scan, frameCount, overrides) {
  let status = String(result.status || "").trim().toLowerCase();
  if (!["ready", "fault", "unclear"].includes(status)) status = result.passed ? "ready" : "unclear";

  let cited = (result.ready_frames || []).filter((n) => Number.isInteger(n) && n >= 1 && n <= frameCount);
  let reason = null;
  if (status === "ready") {
    // The model says ready but named no frame, and the scan found the light
    // blinking: the scan's frames are the evidence.
    if (!cited.length && scan?.flashPositions?.length) {
      cited = [...scan.flashPositions];
      overrides.push("readiness_scan_evidence");
    }
    if (!cited.length) reason = "no_evidence";
    else if (profile.blinkingReady && scan && scan.flashCount === 0) reason = "no_flash_in_video";
  }

  // A light that never blinked, filmed well, is a unit that is not ready.
  if (
    (status === "ready" ||
      (status === "unclear" && result.indicator_in_view === true) ||
      // The model's own "fault" for a light that never lit, said the same
      // clear way. A red light is its own fault, and keeps the model's words.
      (status === "fault" && !/\bred\b/i.test(result.notes || ""))) &&
    profile.blinkingReady &&
    scan &&
    scan.flashCount === 0 &&
    scan.duration >= NEVER_BLINKED_SECONDS &&
    scan.steadyShare >= NEVER_BLINKED_STEADY
  ) {
    overrides.push("readiness_never_blinked");
    return {
      ...result,
      status: "fault",
      passed: false,
      confidence: Math.min(result.confidence ?? 0, 0.8),
      notes: neverBlinkedNotes(profile, scan.duration),
    };
  }

  if (reason) {
    overrides.push(`readiness_${reason}`);
    return {
      ...result,
      status: "unclear",
      passed: false,
      confidence: Math.min(result.confidence ?? 0, 0.5),
      notes: profile.readinessRetake,
    };
  }
  return { ...result, status, passed: status === "ready", key_frame_index: cited[0] ?? result.key_frame_index };
}

// Cheap, deterministic checks independent of the model's own confidence.
// Never upgrades a verdict on its own say-so; the only values it changes are
// ones a standard defines (a GS1 expiry the model read differently) or the
// verdict on a date it read with certainty.
export function applyDeterministicChecks(item, result, { profile, scan = null, frameCount = 1, overrides = [], today = utcToday() }) {
  // The prompt requires a short explanation for every verdict. A response
  // that skips it is a malformed or truncated read, not a confident one:
  // clamping confidence routes it to manual review in AutoInspection.jsx.
  if (!result.notes || !String(result.notes).trim()) {
    overrides.push("no_explanation");
    return { ...result, confidence: Math.min(result.confidence ?? 0, 0.4), notes: OVERRIDE_NOTES.noExplanation };
  }

  // A different maker's AED in the photo can't pass this unit's check —
  // most often the wrong model was picked. Said plainly, with the way out.
  const other = differentBrand(result, profile);
  if (other) {
    overrides.push("different_brand");
    return {
      ...result,
      passed: false,
      status: item.id === "readiness_indicator" ? "unclear" : result.status,
      notes:
        `This looks like a ${other} AED, not the ${profile.name} you selected. If you picked the wrong model, go ` +
        "back and change it; if not, retake the photo of this unit.",
    };
  }

  if (item.id === "readiness_indicator") return checkReadiness(result, profile, scan, frameCount, overrides);

  if (item.id === "battery_expiry_date" && profile.batteryLifeMonths) {
    return dateBatteryByAge(result, profile, today, overrides);
  }

  if ((item.id === "pads_expiry_date" || item.id === "battery_expiry_date") && result.expiry_date) {
    const gs1 = parseGs1Dates(result.expiry_raw_text || "");

    // A manufacture date reported as the expiry makes fresh stock look years
    // dead and raises a false alarm with the hotel. If the model handed back
    // the same date for both, or the date the barcode itself labels as
    // production, it read one date and guessed at its meaning: refuse it.
    const gs1Production = gs1["11"];
    const gs1Expiry = gs1["17"] || gs1["15"];
    if (
      (result.manufacture_date && result.manufacture_date === result.expiry_date) ||
      (gs1Production && gs1Production === result.expiry_date && gs1Expiry !== result.expiry_date)
    ) {
      overrides.push("expiry_was_manufacture_date");
      return { ...result, passed: false, expiry_date: null, notes: OVERRIDE_NOTES.manufactureAsExpiry };
    }

    // A GS1 '(17)' (or '(15)') field is the expiry by definition of the
    // standard. When the model's reading of the printed dates disagrees
    // with it, the barcode wins.
    if (gs1Expiry && gs1Expiry.slice(0, 7) !== result.expiry_date.slice(0, 7)) {
      overrides.push("expiry_corrected_from_gs1");
      result = { ...result, expiry_date: gs1Expiry };
    }

    if (!isPlausibleExpiry(result.expiry_date, today) || !expiryCrossCheckAgrees(result.expiry_date, result.expiry_raw_text)) {
      overrides.push("expiry_implausible");
      return { ...result, passed: false, expiry_date: null, notes: OVERRIDE_NOTES.implausibleExpiry };
    }

    // Upgrade a month-only reading to a full date — only ever a more
    // precise form of the SAME month, never the first date in the raw text,
    // which on a Philips battery is the manufacture date.
    if (result.expiry_raw_text && result.expiry_date.length === 7) {
      const precise = parseAllExpiryDates(result.expiry_raw_text).find((c) => c.length === 10 && c.startsWith(result.expiry_date));
      if (precise) result = { ...result, expiry_date: precise };
    }

    // Expired or not is decided here, against the server's own clock —
    // never by the model.
    const lastValid = expiryLastValidDay(result.expiry_date);
    if (lastValid && lastValid < today) {
      overrides.push(result.passed ? "expired_model_said_pass" : "expired");
      return { ...result, passed: false, notes: expiredNotes(item.id, lastValid) };
    }

    // In date. The model only reports what it saw; the verdict is ours.
    // Damage fails whatever the date. A date it couldn't read with certainty
    // is a retake. A date it read with certainty, on an intact item, passes
    // — even when the model, misjudging the calendar, said otherwise.
    if (lastValid) {
      if (result.damage_seen) {
        if (result.passed) overrides.push("damage_seen");
        return { ...result, passed: false };
      }
      if (result.date_legible === false) {
        if (result.passed) overrides.push("date_not_certain");
        return { ...result, passed: false };
      }
      if (result.date_legible && (result.confidence ?? 0) >= 0.5) {
        if (!result.passed) overrides.push("in_date_model_said_fail");
        return { ...result, passed: true, notes: inDateNotes(item.id, lastValid, today) };
      }
    }
  }

  return result;
}

/**
 * Date a battery that carries no expiry of its own (Powerheart G5). Its
 * maker prints only the manufacture date and guarantees the battery for a
 * fixed life from installation. So: from the installation date when one is
 * written on it, else from manufacture. Counting from manufacture can only
 * come out EARLIER than the truth — a battery is never fitted before it is
 * made — the safe direction for a safety device: it may ask for a battery a
 * little early, never pass a dead one.
 */
function dateBatteryByAge(result, profile, today, overrides) {
  const usable = (value) => {
    const v = String(value || "").trim();
    if (!isPlausibleExpiry(v, today)) return null;
    // A date in the future can't be when a battery was made or fitted.
    const firstDay = new Date(`${v.length === 10 ? v : `${v}-01`}T00:00:00Z`);
    return firstDay <= today ? v : null;
  };

  let made = usable(result.manufacture_date);
  if (!made && !result.manufacture_date && !result.install_date && result.expiry_date) {
    // This battery has no expiry, so a lone date read as one is the
    // manufacture date the model was told to look for.
    made = usable(result.expiry_date);
    if (made) overrides.push("battery_date_read_as_manufacture");
  }
  let installed = usable(result.install_date);
  if (installed && made && installed.slice(0, 7) < made.slice(0, 7)) installed = null; // fitted before made: a misread

  const base = installed || made;
  const datedFrom = installed ? "install" : "manufacture";
  if (!base) {
    overrides.push("battery_date_unread");
    return {
      ...result,
      passed: false,
      expiry_date: null,
      confidence: Math.min(result.confidence ?? 0, 0.4),
      notes: OVERRIDE_NOTES.batteryMadeUnread,
    };
  }

  const dueStr = addMonths(base, profile.batteryLifeMonths);
  const due = expiryLastValidDay(dueStr);
  overrides.push(`battery_dated_from_${datedFrom}`);
  const dated = { ...result, expiry_date: dueStr, manufacture_date: made || result.manufacture_date, install_date: installed };
  const years = profile.batteryLifeMonths / 12;
  const expired = due < today;

  let notes;
  if (datedFrom === "install") {
    notes =
      `Battery installed ${fmtMonth(base)}; its ${years}-year life ` +
      (expired ? `ended on ${fmtDay(due)}. Replace the battery before this AED is relied on in an emergency.` : `runs to ${fmtDay(due)}.`);
  } else if (expired) {
    notes =
      `This battery has no expiry date printed, only the date it was made (${fmtMonth(base)}). Counting ZOLL's ` +
      `${years}-year battery life from then, it was due for replacement by ${fmtDay(due)}. Replace it, unless you ` +
      "have a record that it was installed later.";
  } else {
    notes =
      `Battery made ${fmtMonth(base)}, with no expiry date printed. Counting ZOLL's ${years}-year battery life ` +
      `from then, plan to replace it by ${fmtDay(due)}.`;
  }
  if (!expired && daysBetween(today, due) <= 90) notes += " That's within three months — order a replacement battery soon.";

  if (expired) {
    overrides.push(result.passed ? "expired_model_said_pass" : "expired");
    return { ...dated, passed: false, notes };
  }
  if (result.damage_seen) return { ...dated, passed: false };
  if (result.date_legible === false || (result.confidence ?? 0) < 0.5) return { ...dated, passed: false };
  return { ...dated, passed: true, notes };
}
