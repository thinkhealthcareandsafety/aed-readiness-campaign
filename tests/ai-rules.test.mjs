// Unit tests for the campaign's AI decision rules and model fallback.
// Run: npm test
import assert from "node:assert/strict";
import { test } from "node:test";

const lib = new URL("../lib/", import.meta.url).href;
const { applyDeterministicChecks, firstAnswer } = await import(lib + "inspectionGemini.js");
const { getChecklistItem } = await import(lib + "inspectionChecklist.js");
const { getDeviceProfile } = await import(lib + "aedDeviceProfiles.js");
const V = await import(lib + "inspectionValidators.js");

const TODAY = new Date(Date.UTC(2026, 9, 10)); // 10 Oct 2026
const pads = getChecklistItem("pads_expiry_date");
const battery = getChecklistItem("battery_expiry_date");
const readiness = getChecklistItem("readiness_indicator");
const run = (item, model, result, extra = {}) => {
  const overrides = [];
  const out = applyDeterministicChecks(item, { notes: "seen", confidence: 0.9, ...result }, {
    profile: getDeviceProfile(model), today: TODAY, overrides, frameCount: 24, ...extra,
  });
  return { out, overrides };
};

// ── Validators ──────────────────────────────────────────────────────────
test("GS1 dates are read by field code, day 00 = month only", () => {
  assert.deepEqual(V.parseGs1Dates("(11)230301 (17)281200 (15)270419"), { 11: "2023-03-01", 17: "2028-12", 15: "2027-04-19" });
});
test("every date on a label is found, a Y-M-D never re-read as its Y-M", () => {
  assert.deepEqual(V.parseAllExpiryDates("factory 2026-01-13 / install before 2031-11"), ["2026-01-13", "2031-11"]);
});
test("a month-only expiry is good through the month's last day", () => {
  assert.equal(V.expiryLastValidDay("2026-02").toISOString().slice(0, 10), "2026-02-28");
  assert.equal(V.addMonths("2024-02-29", 48), "2028-02-29");
  assert.equal(V.addMonths("2022-06", 48), "2026-06");
});
test("an expiry 20 years old is believed; 9 years ahead is a misread", () => {
  assert.equal(V.isPlausibleExpiry("2019-05", TODAY), true);
  assert.equal(V.isPlausibleExpiry("2035-01", TODAY), false);
});

// ── Expiry dates: the server decides ────────────────────────────────────
test("expired pads fail even when the model passed them", () => {
  const { out, overrides } = run(pads, "frx", { passed: true, expiry_date: "2026-03", date_legible: true });
  assert.equal(out.passed, false);
  assert.match(out.notes, /^The pads expired on 31 Mar 2026\./);
  assert.equal(out.expiry_date, "2026-03"); // kept, so the form shows it as expired
  assert.deepEqual(overrides, ["expired_model_said_pass"]);
});
test("in-date pads read with certainty pass even when the model failed them", () => {
  const { out, overrides } = run(pads, "hs1", { passed: false, expiry_date: "2027-11", date_legible: true, damage_seen: false });
  assert.equal(out.passed, true);
  assert.equal(out.notes, "Pads in date until 30 Nov 2027.");
  assert.deepEqual(overrides, ["in_date_model_said_fail"]);
});
test("pads expiring this month are still in date, with an order-soon note", () => {
  const { out } = run(pads, "frx", { passed: true, expiry_date: "2026-10", date_legible: true });
  assert.equal(out.passed, true);
  assert.match(out.notes, /until 31 Oct 2026\. That's within three months/);
});
test("damage fails in-date pads; an uncertain digit is a retake", () => {
  assert.equal(run(pads, "frx", { passed: true, expiry_date: "2028-01", date_legible: true, damage_seen: true }).out.passed, false);
  assert.equal(run(pads, "frx", { passed: true, expiry_date: "2028-01", date_legible: false }).out.passed, false);
});
test("a manufacture date reported as the expiry is refused", () => {
  const { out } = run(battery, "frx", { passed: true, expiry_date: "2026-01-13", manufacture_date: "2026-01-13" });
  assert.equal(out.passed, false);
  assert.equal(out.expiry_date, null);
  assert.match(out.notes, /manufacture date, not the expiry/);
});
test("the GS1 (17) barcode date overrides a printed date read differently", () => {
  const { out, overrides } = run(pads, "zollPlus", {
    passed: true, expiry_date: "2027-12", expiry_raw_text: "(17)281228 / 2028-12-28", date_legible: true,
  });
  assert.equal(out.expiry_date, "2028-12-28");
  assert.ok(overrides.includes("expiry_corrected_from_gs1"));
});
test("a month-only reading is made precise only from the same month", () => {
  const { out } = run(battery, "frx", {
    passed: true, expiry_date: "2031-11", expiry_raw_text: "factory 2026-01-13 / install before 2031-11-30", date_legible: true,
  });
  assert.equal(out.expiry_date, "2031-11-30");
});
test("an implausible year is a retake, not a pass", () => {
  const { out } = run(pads, "frx", { passed: true, expiry_date: "2045-01", date_legible: true });
  assert.equal(out.passed, false);
  assert.equal(out.expiry_date, null);
});

// ── Powerheart G5 battery: no expiry printed ────────────────────────────
test("a G5 battery is due 4 years from manufacture when no install date", () => {
  const { out } = run(battery, "g5", { passed: true, manufacture_date: "2022-06-16", date_legible: true });
  assert.equal(out.expiry_date, "2026-06-16");
  assert.equal(out.passed, false);
  assert.match(out.notes, /only the date it was made \(16 Jun 2022\).*by 16 Jun 2026/);
});
test("a G5 battery with an install date is dated from that", () => {
  const { out, overrides } = run(battery, "g5", {
    passed: true, manufacture_date: "2024-03", install_date: "2025-01", date_legible: true,
  });
  assert.equal(out.expiry_date, "2029-01");
  assert.equal(out.passed, true);
  assert.ok(overrides.includes("battery_dated_from_install"));
});
test("a G5 battery date read into expiry_date is treated as manufacture", () => {
  const { out, overrides } = run(battery, "g5", { passed: true, expiry_date: "2025-05", date_legible: true });
  assert.equal(out.expiry_date, "2029-05");
  assert.ok(overrides.includes("battery_date_read_as_manufacture"));
});

// ── Readiness ───────────────────────────────────────────────────────────
const scan = (flashPositions, flashCount, duration = 12, steadyShare = 1) => ({ times: [], flashPositions, flashCount, duration, steadyShare });
test("an FRx that never blinked in a long steady clip is not ready", () => {
  const { out } = run(readiness, "frx", { passed: true, status: "ready", ready_frames: [4] }, { scan: scan([], 0) });
  assert.equal(out.status, "fault");
  assert.equal(out.passed, false);
  assert.match(out.notes, /did not blink once in 12 seconds/);
});
test("a short dark FRx clip is a retake, not a fault", () => {
  const { out } = run(readiness, "frx", { passed: true, status: "ready", ready_frames: [4] }, { scan: scan([], 0, 5) });
  assert.equal(out.status, "unclear");
  assert.match(out.notes, /Ready light/);
});
test("a ready FRx citing a frame, with a scanned flash, passes", () => {
  const { out } = run(readiness, "frx", { passed: true, status: "ready", ready_frames: [7] }, { scan: scan([7, 15], 2) });
  assert.equal(out.status, "ready");
  assert.equal(out.passed, true);
  assert.equal(out.key_frame_index, 7);
});
test("a ready with no frame cited uses the scan's flashes as evidence", () => {
  const { out, overrides } = run(readiness, "hs1", { passed: true, status: "ready", ready_frames: [] }, { scan: scan([3, 11], 2) });
  assert.equal(out.passed, true);
  assert.ok(overrides.includes("readiness_scan_evidence"));
});
test("a ready with no evidence at all is a retake naming this unit's light", () => {
  const { out } = run(readiness, "defibtech", { passed: true, status: "ready", ready_frames: [] }, { scan: null });
  assert.equal(out.status, "unclear");
  assert.match(out.notes, /top-right corner/);
});
test("a ZOLL steady green check passes without any blink", () => {
  const { out } = run(readiness, "zollPlus", { passed: true, status: "ready", ready_frames: [2, 3] }, { scan: scan([], 0) });
  assert.equal(out.passed, true);
});
test("a red light keeps the model's own fault words", () => {
  const { out } = run(readiness, "frx", { passed: false, status: "fault", notes: "The light is flashing red." }, { scan: scan([], 0) });
  assert.equal(out.status, "fault");
  assert.equal(out.notes, "The light is flashing red.");
});
test("cited frames outside the clip don't count", () => {
  const { out } = run(readiness, "g5", { passed: true, status: "ready", ready_frames: [99] }, { scan: scan([], 0), frameCount: 24 });
  assert.equal(out.status, "unclear");
});

// ── Brand and malformed answers ─────────────────────────────────────────
test("a different maker's AED can't pass this unit's check", () => {
  const { out } = run(pads, "frx", { passed: true, expiry_date: "2028-01", date_legible: true, brand_seen: "ZOLL AED Plus" });
  assert.equal(out.passed, false);
  assert.match(out.notes, /looks like a ZOLL AED, not the Philips HeartStart FRx/);
});
test("a G5 labelled ZOLL is the same unit, not a different brand", () => {
  const { out } = run(pads, "g5", { passed: true, expiry_date: "2028-01", date_legible: true, brand_seen: "ZOLL" });
  assert.equal(out.passed, true);
});
test("an answer with no explanation goes to manual review", () => {
  const { out } = run(pads, "frx", { passed: true, notes: " ", confidence: 0.95, expiry_date: "2028-01" });
  assert.ok(out.confidence <= 0.4);
});

// ── Model fallback ──────────────────────────────────────────────────────
const opts = { hedgeMs: 60, budgetMs: 2000, itemId: "t" };
const err = (status, message = "") => Object.assign(new Error(message || `HTTP ${status}`), { status });
const hang = (signal) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));

test("a healthy first model answers alone", async () => {
  const calls = [];
  const r = await firstAnswer(["a", "b"], async (m) => (calls.push(m), m), opts);
  assert.equal(r.model, "a");
  assert.deepEqual(calls, ["a"]);
});
test("an overloaded first model hands over to the second at once", async () => {
  const t0 = Date.now();
  const r = await firstAnswer(["a", "b"], async (m) => { if (m === "a") throw err(503); return m; }, { ...opts, hedgeMs: 5000 });
  assert.equal(r.model, "b");
  assert.ok(Date.now() - t0 < 1000, "failover should not wait for the hedge delay");
});
test("a stalled first model is overtaken after the hedge delay", async () => {
  const r = await firstAnswer(["a", "b"], async (m, signal) => (m === "a" ? hang(signal) : m), opts);
  assert.equal(r.model, "b");
});
test("a daily quota refusal moves on to the next model", async () => {
  const r = await firstAnswer(["a", "b"], async (m) => { if (m === "a") throw err(429, '{"quotaId":"GenerateRequestsPerDayPerProject"}'); return m; }, { ...opts, hedgeMs: 5000 });
  assert.equal(r.model, "b");
});
test("a withdrawn first model (404) hands over at once", async () => {
  const t0 = Date.now();
  const r = await firstAnswer(["a", "b"], async (m) => { if (m === "a") throw err(404, "not found"); return m; }, { ...opts, hedgeMs: 5000 });
  assert.equal(r.model, "b");
  assert.ok(Date.now() - t0 < 500);
});
test("a bad request fails without retrying", async () => {
  let n = 0;
  await assert.rejects(firstAnswer(["a", "b"], async () => { n++; throw err(400, "bad"); }, { ...opts, hedgeMs: 10 }), /bad/);
  assert.equal(n, 2);
});
test("the overall budget is enforced", async () => {
  await assert.rejects(firstAnswer(["a", "b"], async (m, signal) => hang(signal), { ...opts, budgetMs: 300 }), /exceeded/);
});
