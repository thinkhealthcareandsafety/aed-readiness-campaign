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
// components/AutoInspection.jsx), passing that unit's own selected model.
// These prompts are the device-NEUTRAL half of each instruction: the task
// and how to judge it. Where things are on a particular unit, and what
// "ready" or "fitted" looks like on it, comes from that unit's profile in
// lib/aedDeviceProfiles.js. See fieldRoleFor() for how a (concept, unit)
// pair maps onto the right form field.

// Medical consumables carry SEVERAL dates, and picking the wrong one is the
// most damaging mistake this check can make: reading a manufacture date as
// an expiry tells a hotel a battery built last month is already dead. The
// rule is semantic, not "take the latest date". For a safety device the
// unsafe direction is reporting an expiry LATER than the truth, so where two
// genuine expiry-type dates disagree, the EARLIER one is taken.
const DATE_SYMBOLS = `Medical device labels print more than one date, each tagged with a standard ISO 15223-1 symbol. Identify them by symbol and wording, never by which number is largest:
- A FACTORY building icon marks the DATE OF MANUFACTURE. This is NOT an expiry. Never report it as one. Put it in manufacture_date.
- An HOURGLASS marks the USE BY / EXPIRY date.
- An ARROW POINTING INTO A BRACKET, or the words 'Install before', mark the INSTALL-BEFORE date. On AED batteries this is usually the date that matters, and the one to report.
- Printed words such as 'EXP', 'Use by', 'Install before' or 'Replace ... on or before' override any symbol.
- Barcode labels often repeat dates in GS1 form: '(17)YYMMDD' is the expiry/use-by date, '(15)YYMMDD' a best-before or install-by date, and '(11)YYMMDD' the production date; '(10)' introduces the LOT and '(21)' the serial number. A '(17)' or '(15)' date confirms the expiry; a '(11)' date is a manufacture date.
- A date written as NN/NN/YYYY is ambiguous when both numbers are 12 or less (12/05/2029 could be 12 May or 5 December): report the EARLIER of the two readings and mention the ambiguity in notes. When one number is over 12, it is the day.

Set expiry_date to the USE BY / INSTALL BEFORE / REPLACE-BY date. Set manufacture_date to the factory date when one is visible. If two genuine expiry-type dates are present and you cannot tell which governs, report the EARLIER one and explain the ambiguity in notes — never the later one. If the only date you can read is a manufacture date, set expiry_date to null, passed=false, and say the expiry date was not visible.

Copy every date you can see, verbatim and with whatever labels it carries, into expiry_raw_text (for example: 'factory 2026-01-13 / install-before 2031-11-30', or '(17)221228 / 2022-12-28').`;

const FINE_PRINT =
  "This is fine print — if it is too small, angled, glared or blurry to read with certainty, do not guess: " +
  "leave the field null, set passed=false, and say in notes what the inspector should change (move closer, " +
  "reduce glare, hold steady).";

// The model is good at reading a label and poor at calendars: it has failed
// in-date pads as "expiring next month" and passed expired ones it thought
// were in the future. So it only reports what it sees; the server decides
// expired or not, against today's date (see lib/inspectionGemini.js).
const READ_DONT_JUDGE =
  "Set date_legible=true only if you read the expiry date with certainty (false if you are unsure of any " +
  "digit). Set damage_seen=true if the item is visibly damaged, opened, swollen, leaking or corroded, false if " +
  "it looks intact, null if you cannot see it. Do NOT decide whether the date has passed or is coming up — the " +
  "app checks the date against today itself. Set passed=true if you read the expiry date with certainty and " +
  "see no damage.";

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
      "Find the expiry date of the electrode pads, on their cartridge, case or sealed pack.\n\n" +
      `${DATE_SYMBOLS}\n\n` +
      `Normalise expiry_date to YYYY-MM or YYYY-MM-DD. ${FINE_PRINT}\n\n` +
      READ_DONT_JUDGE,
  },
  {
    id: "battery_expiry_date",
    order: 3,
    title: "Battery expiry",
    description: "Photo of the battery label expiry date.",
    mediaType: "image",
    prompt:
      "Find the date by which the AED's battery must be installed or replaced.\n\n" +
      `${DATE_SYMBOLS}\n\n` +
      `Normalise expiry_date to YYYY-MM or YYYY-MM-DD. ${FINE_PRINT}\n\n` +
      READ_DONT_JUDGE,
  },
  {
    id: "battery_attached",
    order: 4,
    title: "Battery attached",
    description: "Photo confirming the battery is fully seated in the machine.",
    mediaType: "image",
    prompt:
      "Determine whether the battery is fully and correctly installed in the AED — seated and latched, with no " +
      "visible gap, tilt or raised edge. Set passed=true only if the battery is clearly, fully installed. If the " +
      "photo doesn't show the battery area clearly enough to judge, set passed=false and ask for a clearer angle " +
      "in notes.",
  },
  {
    id: "pads_connected",
    order: 5,
    title: "Pads connected",
    description: "Photo confirming the pads connector is plugged into the machine.",
    mediaType: "image",
    prompt:
      "Determine whether the electrode pads are connected to the AED, so it could deliver a shock straight " +
      "away. Set passed=true only if you can actually SEE the connection made — the plug or cartridge the device " +
      "notes describe, seated in place. Never assume a connection you cannot see. If the connector or cartridge " +
      "well is visible and empty, the pads are NOT connected: set passed=false and say plainly in notes that the " +
      "pads are not connected and must be plugged in before the AED can be relied on. If the photo doesn't show " +
      "the connector clearly enough to judge, set passed=false and ask for a closer photo of it.",
  },
  // aed_cabinet_ok was auto-inspected here too (a photo) — left dropped
  // deliberately. Cabinet condition is a judgment call a photo often can't
  // resolve any better than the responder's own eyes standing in front of
  // it. That question still gets answered manually, in its normal spot in
  // Physical Status, with the same real reference photo it already showed
  // (aed-cabinet-example.jpg) — not skipped or left blank.
  //
  // readiness_indicator: a "ready" is only as good as the frame it can point
  // to. The wording this replaces told the model flashes could fall between
  // frames, that one flash anywhere was enough, and to prefer a ready/fault
  // call over "unclear" — so a clip where the light never came on could
  // still pass. Now it must name the frames that show the ready signal, and
  // the server checks them against the browser's scan of every frame (see
  // lib/readinessScan.js and checkReadiness in lib/inspectionGemini.js).
  {
    id: "readiness_indicator",
    order: 6,
    title: "Readiness indicator",
    description: "Short video of the readiness light — at least 10 seconds, up close and steady, aimed at the small status light, not the power button.",
    mediaType: "video",
    prompt:
      "Decide whether this AED's readiness indicator shows it is ready for use. The device notes below say " +
      "where the indicator is on THIS model and what 'ready' and 'fault' look like on it — find that indicator " +
      "and judge only it, never any other light, button or reflection.\n\n" +
      "Look at every frame. In ready_frames, list the numbers of the frames in which you can actually SEE the " +
      "ready signal: for a light that blinks, the frames where that light is visibly lit; for a symbol, the " +
      "frames where the ready symbol is clearly readable. List nothing you would have to assume.\n" +
      "- status='ready', passed=true: ONLY if ready_frames is not empty. Never conclude that a light blinked " +
      "between frames — if no frame shows it lit, readiness is not confirmed.\n" +
      "- status='fault', passed=false: a fault signal is visible (see the device notes), or the indicator is " +
      "clearly in view and in focus through the whole clip and never shows the ready signal.\n" +
      "Separately, set indicator_in_view: true if the place where this unit's indicator sits (see the device " +
      "notes) is clearly in frame, close enough and in focus in most frames — WHETHER OR NOT the light is lit. " +
      "An unlit light whose lens or window you can locate is in view. false if that place is out of frame, too " +
      "far away, too dark or blurred.\n" +
      "- status='unclear', passed=false: the indicator can't be judged — out of frame, too far away, too dark, " +
      "or blurred.\n\n" +
      "When notes say where to film, name the indicator only by its place on THIS unit, as the device notes " +
      "describe it; mention another button or light only if the frames show the inspector filmed that one " +
      "instead.\n" +
      "In notes, say what you saw; if it is not ready, say exactly what to do next (for example: film just the " +
      "indicator, up close and steady, for at least 10 seconds — or, if it shows a fault, that the unit needs " +
      "service).",
  },
];

const _BY_ID = new Map(CHECKLIST_ITEMS.map((item) => [item.id, item]));

export function getChecklistItem(id) {
  return _BY_ID.get(id);
}
