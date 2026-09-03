// AI auto-inspection checklist — ported from the sibling aed-inspection-platform
// project's python-cv/app/services/checklist_items.py, trimmed to the items
// that map onto an existing scored question in seedFormData.js (see fieldRole
// tags there). Each item is satisfied by one uploaded photo (or, for the
// readiness indicator, a short video) and one Gemini call.
//
// serial_number is deliberately NOT in this list — the wizard now collects
// every unit's serial number manually during AED Status (device
// registration), before the manual/AI-scan choice even appears, so asking
// the AI-scan path to re-photograph something already typed would be pure
// friction with no upside.
//
// Every item here is defined ONCE per *concept*, not once per physical AED
// unit — auto-inspection runs it once per reported unit (see
// components/AutoInspection.jsx), passing that unit's own selected model so
// the prompt can give brand-accurate guidance instead of guessing. See
// modelContextFor() below and fieldRoleFor() for how a (concept, unit) pair
// maps onto the right form field.

// Brand-specific part-layout guidance, keyed by the same model value used in
// the "Select your AED model(s)" question (lib/seedFormData.js). Injected
// into every prompt so the AI looks in the right place for *this* unit's
// actual hardware instead of assuming every AED looks like a Philips FRx —
// the previous version hardcoded Philips guidance onto every unit
// regardless of what was actually selected, which is actively worse than no
// guidance at all for a hotel with a ZOLL or Cardiac Science unit.
const MODEL_CONTEXT = {
  frx:
    "The device is a Philips HeartStart FRx — bright orange/yellow rugged case, single push-button " +
    "operation, small green flashing status light on the front. The battery pack (model M5070A, " +
    "black/dark-grey) slides into the back/bottom of the unit. The pads connector is a small socket " +
    "on the top edge.",
  hs1:
    "The device is a Philips HeartStart HS1 — bright orange/yellow case. The battery pack (model " +
    "M5071A, black/dark-grey) slides into the back/bottom of the unit. The pads are a sealed " +
    "cartridge that slots into the top of the case as one piece (pads + connector combined). The " +
    "small status light/window is near the carry-handle end of the case.",
  zollPlus:
    "The device is a ZOLL AED Plus — rugged case, usually yellow or blue-grey. It takes 10 standard " +
    "lithium batteries in a battery door on the back, not a slide-in proprietary pack. The pads are " +
    "the pre-connected CPR-D-padz type — the padz packet's cable plugs into a port on top of the " +
    "unit, so 'pads connected' means that cable is seated in that port, not that a separate " +
    "connector clicks in. The status window on the front shows a check mark (ready) or a replace " +
    "icon (needs service).",
  g5:
    "The device is a Cardiac Science Powerheart G5 — case is typically white/grey with a green carry " +
    "handle. The battery is a rectangular pack that slides into a compartment on the back. The pads " +
    "connector is a cable that plugs into a port on the front face. The status indicator is an " +
    "icon-based screen or a simple light near the handle.",
  defibtech:
    "The device is a Defibtech Lifeline/Lifeline AUTO — white case with an orange accent stripe. The " +
    "battery pack slides into the bottom of the unit. The pads connector plugs into a port on the " +
    "top. The status indicator is a small light near the carry handle: green means ready, red means " +
    "it needs service.",
  crPlus:
    "The device is a Physio-Control/Stryker LIFEPAK CR Plus — compact case, usually blue-grey. The " +
    "battery is a rectangular pack in a compartment on the back. The pads are pre-connected " +
    "(QUIK-COMBO), permanently wired to the unit — 'pads connected' means the pads packet's own " +
    "connector is seated in the unit's port. The status indicator is a small screen or light on the " +
    "front.",
  lp1000:
    "The device is a Physio-Control/Stryker LIFEPAK 1000 — rugged case, usually orange or yellow. The " +
    "battery is a rectangular pack that slides into the back. The pads (QUIK-COMBO) connector plugs " +
    "into a port on the front. The status indicator is a status light and/or small LCD screen on the " +
    "front panel.",
};
const DEFAULT_MODEL_CONTEXT =
  "This unit's exact AED brand/model wasn't specified, or doesn't match a known preset — do not " +
  "assume any particular brand's part layout. Identify the battery compartment, pads connector, " +
  "cabinet/case, and status light generically from what's actually visible in the photo, and if the " +
  "device's make/model would help give a more precise reading, say so in notes.";

export function modelContextFor(model) {
  return MODEL_CONTEXT[model] || DEFAULT_MODEL_CONTEXT;
}

// Concept id -> the fieldRole prefix used in seedFormData.js. Unit 1 kept
// its original, already-live fieldRole strings exactly as-is (some end in
// "_1", some don't — that inconsistency predates this file and isn't worth
// a data migration to tidy up); every unit from 2 up follows one consistent
// "<prefix>_<unit>" pattern, matching how expandUnitQuestions numbers
// cloned questions elsewhere (lib/genericScoring.js).
const UNIT_1_FIELD_ROLE = {
  battery_attached: "battery_attached",
  pads_connected: "pads_connected",
  aed_cabinet_ok: "aed_cabinet_ok",
  readiness_indicator: "readiness_indicator",
  battery_expiry_date: "battery_expiry_date_1",
  pads_expiry_date: "pads_expiry_date_1",
};

export function fieldRoleFor(baseId, unit) {
  if (unit === 1) return UNIT_1_FIELD_ROLE[baseId] || baseId;
  return `${baseId}_${unit}`;
}

// id must match a concept key above (and, for unit 1, a fieldRole tagged
// onto the corresponding question in lib/seedFormData.js) so the wizard can
// map a result back onto the form without hardcoding question ids.
export const CHECKLIST_ITEMS = [
  {
    id: "pads_expiry_date",
    order: 2,
    title: "Pads expiry",
    description: "Photo of the electrode pads packaging expiry date.",
    mediaType: "image",
    prompt:
      "Find the electrode pads label — either on the sealed pads cartridge/pouch itself or the pads " +
      "connector cassette. Read the expiry date exactly as printed into expiry_raw_text, and also " +
      "set expiry_date normalised to YYYY-MM or YYYY-MM-DD. This is fine print — if unclear, leave " +
      "both null, set passed=false, and explain what to fix in notes.",
  },
  {
    id: "battery_expiry_date",
    order: 3,
    title: "Battery expiry",
    description: "Photo of the battery label expiry date.",
    mediaType: "image",
    prompt:
      "Find the battery label and read the expiry date exactly as printed into expiry_raw_text, and " +
      "also set expiry_date normalised to YYYY-MM or YYYY-MM-DD. This is fine print — if unclear, " +
      "leave both null, set passed=false, and explain what to fix in notes.",
  },
  {
    id: "battery_attached",
    order: 4,
    title: "Battery attached",
    description: "Photo confirming the battery is fully seated in the machine.",
    mediaType: "image",
    prompt:
      "Determine whether the battery pack is fully and correctly inserted/latched into the AED body, " +
      "with no visible gap, tilt, or the release latch left unseated. Set passed=true only if the " +
      "battery is clearly, fully attached. If the photo doesn't show the battery compartment clearly " +
      "enough to judge, set passed=false and ask the inspector for a clearer angle in notes.",
  },
  {
    id: "pads_connected",
    order: 5,
    title: "Pads connected",
    description: "Photo confirming the pads connector is plugged into the machine.",
    mediaType: "image",
    prompt:
      "Determine whether the electrode pads connector is firmly plugged into the AED's pads port. " +
      "Set passed=true only if the connection is clearly seated with no visible gap. If unclear, set " +
      "passed=false and ask for a clearer angle in notes.",
  },
  // aed_cabinet_ok was auto-inspected here too (a photo) — left dropped
  // deliberately. Cabinet condition is a judgment call a photo often can't
  // resolve any better than the responder's own eyes standing in front of
  // it. That question still gets answered manually, in its normal spot in
  // Physical Status, with the same real reference photo it already showed
  // (aed-cabinet-example.jpg) — not skipped or left blank.
  //
  // readiness_indicator (the status-light blink video) was dropped for a
  // while too, then restored: it's genuinely the trickiest capture in the
  // flow, but skipping it meant that question got zero AI assistance at
  // all rather than a lower hit-rate one, and "unclear" already routes
  // cleanly to manual review (see MIN_CONFIDENCE in AutoInspection.jsx) —
  // so a capture that doesn't land isn't a dead end, it's the same
  // fallback every other low-confidence item already has.
  {
    id: "readiness_indicator",
    order: 6,
    title: "Readiness indicator",
    description: "Short video of the status-light blink pattern — record at least 10 seconds, aimed at the small status LED, not the power button.",
    mediaType: "video",
    prompt:
      "WHERE TO LOOK — this is the single most common mistake, avoid it: the readiness indicator is " +
      "a SMALL round status LED or status window, not a large power button. Locate that small " +
      "indicator specifically (see the device-specific guidance above for where it usually sits) " +
      "before judging anything — ignore any large ON/OFF button's own color/state entirely, even if " +
      "it is lit or green.\n\n" +
      "HOW TO JUDGE IT — a healthy, ready-to-use unit blinks that small LED green on a slow cycle; " +
      "the gap between flashes varies by unit and can be as long as 4-5 seconds, so a short clip may " +
      "only catch ONE flash, or catch it right at the very start or end of the clip — that is " +
      "completely normal and is NOT a fault. Watch every frame carefully, start to finish. If you " +
      "see even ONE distinct green flash (or a steady green ready icon on a status window) anywhere " +
      "in the sequence, that alone is sufficient evidence: set status='ready', passed=true. Only set " +
      "status='fault' if that small indicator is clearly, unambiguously showing a red/service-needed " +
      "state, or you can positively confirm it stays completely dark/off the whole time with the " +
      "indicator plainly in frame and in focus throughout. Do not require seeing a full on-off-on " +
      "cycle — one confirmed green flash is enough to pass.\n\n" +
      "If you cannot clearly identify the small indicator's position or color at all (e.g. it's " +
      "completely out of frame, far too dark to make out any color, or too blurry/shaky to tell), " +
      "set status='unclear', passed=false, and say specifically in notes what to fix — e.g. 'record " +
      "at least 10 seconds since blinks can be up to 5 seconds apart', 'move closer to the small " +
      "status indicator, not the power button', or 'hold the camera steady and well lit'. Reserve " +
      "'unclear' for genuinely unusable footage — if the indicator is visible at all, prefer making " +
      "a 'ready'/'fault' call over 'unclear'.",
  },
];

const _BY_ID = new Map(CHECKLIST_ITEMS.map((item) => [item.id, item]));

export function getChecklistItem(id) {
  return _BY_ID.get(id);
}
