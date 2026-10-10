// The whole analyzeChecklistItem path through the real @google/genai SDK,
// with Gemini's HTTP API faked at fetch: what is sent, and what comes back.
// Run: npm test (from the project root: the readiness reference photos are read from public/).
import assert from "node:assert/strict";
import { test } from "node:test";

process.env.GEMINI_API_KEY = "test-key";
const requests = [];
let reply = () => ({});
globalThis.fetch = async (url, init) => {
  const model = /models\/([^:]+):generateContent/.exec(String(url))?.[1];
  const body = JSON.parse(init.body);
  requests.push({ model, body });
  const verdict = reply(model, body);
  return new Response(
    JSON.stringify({
      candidates: [{ content: { role: "model", parts: [{ text: JSON.stringify(verdict) }] }, finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 4321, candidatesTokenCount: 55, thoughtsTokenCount: 0 },
    }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
};

const { analyzeChecklistItem } = await import(new URL("../lib/inspectionGemini.js", import.meta.url).href);
const jpeg = { base64: Buffer.from("fake-jpeg").toString("base64"), mimeType: "image/jpeg" };
const textOf = (body) => body.contents[0].parts.filter((p) => p.text).map((p) => p.text).join("\n");

test("pads expiry: read by two models that agree, verdict decided by the server", async () => {
  requests.length = 0;
  reply = () => ({ passed: false, confidence: 0.92, notes: "Read it.", expiry_date: "2028-12", expiry_raw_text: "2028-12", date_legible: true, damage_seen: false });
  const r = await analyzeChecklistItem("pads_expiry_date", [jpeg], "frx");
  assert.deepEqual(requests.map((q) => q.model).sort(), ["gemini-3.1-flash-lite", "gemini-3.5-flash-lite"]);
  const prompt = textOf(requests[0].body);
  assert.match(prompt, /DEVICE: Philips HeartStart FRx\. A rugged blue-grey Philips unit/);
  assert.match(prompt, /SMART Pads II/);
  assert.match(prompt, /Today's date is \d{4}-\d{2}-\d{2}/);
  assert.equal(requests[0].body.generationConfig.responseMimeType, "application/json");
  assert.ok(requests[0].body.generationConfig.responseSchema.properties.ready_frames);
  assert.equal(r.passed, true);
  assert.equal(r.notes, "Pads in date until 31 Dec 2028.");
  assert.equal(r.meta.second_read, "agrees");
  assert.equal(r.meta.input_tokens, 4321);
  assert.deepEqual(r.meta.overrides, ["in_date_model_said_fail"]);
  assert.match(r.meta.prompt_version, /^[0-9a-f]{10}$/);
});

test("pads expiry: two models that disagree make it a retake", async () => {
  reply = (model) => ({ passed: true, confidence: 0.9, notes: "Read it.", expiry_date: model === "gemini-3.5-flash-lite" ? "2028-12" : "2023-12", date_legible: true });
  const r = await analyzeChecklistItem("pads_expiry_date", [jpeg], "hs1");
  assert.equal(r.passed, false);
  assert.equal(r.expiry_date, null);
  assert.equal(r.meta.second_read, "disagrees");
  assert.match(r.notes, /couldn't read the expiry date with certainty/);
});

test("G5 battery: dated from its manufacture date", async () => {
  reply = () => ({ passed: true, confidence: 0.9, notes: "Factory date read.", manufacture_date: "2025-03-02", date_legible: true });
  const r = await analyzeChecklistItem("battery_expiry_date", [jpeg], "g5");
  assert.equal(r.expiry_date, "2029-03-02");
  assert.equal(r.passed, true);
  assert.match(r.notes, /Battery made 02 Mar 2025, with no expiry date printed/);
});

test("readiness: labelled frames, scan marks, detail levels and reference photo are sent", async () => {
  requests.length = 0;
  reply = () => ({ passed: true, confidence: 0.9, notes: "Green flash seen.", status: "ready", ready_frames: [5], indicator_in_view: true });
  const frames = Array.from({ length: 24 }, () => jpeg);
  const scan = { times: frames.map((_, i) => i * 0.4), flashPositions: [5, 14], flashCount: 2, duration: 10.1, steadyShare: 0.97 };
  const r = await analyzeChecklistItem("readiness_indicator", frames, "hs1", { scan, guided: true });
  assert.equal(requests.length, 1, "no second read for a video");
  const parts = requests[0].body.contents[0].parts;
  assert.match(parts[0].text, /REFERENCE — not from this inspection: a Philips HeartStart HS1/);
  assert.equal(parts[1].mediaResolution.level, "MEDIA_RESOLUTION_LOW");
  const labels = parts.filter((p) => p.text?.startsWith("Frame "));
  assert.equal(labels.length, 24);
  assert.equal(labels[4].text, "Frame 5 — 1.6 s · scan: a small green light switched on here");
  const images = parts.filter((p) => p.inlineData).slice(1); // after the reference photo
  assert.deepEqual(
    images.map((p, i) => (p.mediaResolution.level === "MEDIA_RESOLUTION_HIGH" ? i + 1 : null)).filter(Boolean),
    [5, 14],
    "only the flash frames go at full detail"
  );
  const prompt = parts[parts.length - 1].text;
  assert.match(prompt, /24 still frames from a 10-second video clip/);
  assert.match(prompt, /circle drawn at the centre/);
  assert.match(prompt, /marked the frames where a small green light switched on/);
  assert.equal(r.status, "ready");
  assert.equal(r.key_frame_index, 5);
  assert.equal(r.meta.frames_sent, 24);
  assert.equal(r.meta.flashes_found, 2);
});

test("readiness without a scan: every frame at full detail, no scan claims", async () => {
  requests.length = 0;
  reply = () => ({ passed: true, confidence: 0.9, notes: "Green check.", status: "ready", ready_frames: [2] });
  const frames = Array.from({ length: 8 }, () => jpeg);
  const r = await analyzeChecklistItem("readiness_indicator", frames, "zollPlus", { scan: null });
  const parts = requests[0].body.contents[0].parts;
  const images = parts.filter((p) => p.inlineData).slice(1);
  assert.ok(images.every((p) => p.mediaResolution.level === "MEDIA_RESOLUTION_HIGH"));
  assert.doesNotMatch(parts[parts.length - 1].text, /automatic scan/);
  assert.equal(parts.find((p) => p.text?.startsWith("Frame 1")).text, "Frame 1");
  assert.equal(r.passed, true);
});

test("an unknown model gets generic guidance, never a brand's layout", async () => {
  requests.length = 0;
  reply = () => ({ passed: true, confidence: 0.9, notes: "Seated.", brand_seen: "Mindray" });
  const r = await analyzeChecklistItem("battery_attached", [jpeg], "other");
  assert.match(textOf(requests[0].body), /whose make and model were not given/);
  assert.equal(r.passed, true, "no brand to contradict");
});
