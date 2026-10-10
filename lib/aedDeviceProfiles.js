// What the vision model needs to know about each AED it inspects, keyed by
// the model values of the "Select your AED model(s)" question
// (lib/seedFormData.js). Ported from the sibling aed-inspection-platform
// project's python-cv/app/services/device_profiles.py, where every fact is
// taken from the manufacturer's own documentation:
//   - Philips HeartStart FRx Owner's Manual (861304, edition 13)
//   - Philips HeartStart OnSite (HS1) Owner's Manual (M5066A, edition 14)
//   - ZOLL AED Plus Administrator's Guide (9650-0311-01) and its battery
//     replacement label addendum
//   - Powerheart G5 User's Guide (70-02104-02 D)
//   - Defibtech DDU-100 Series User Manual (DAC-A580-EN-DF), covering the
//     Lifeline (DDU-100) and Lifeline AUTO (DDU-120)
//
// The descriptions this replaces called the FRx and HS1 "bright
// orange/yellow" (both are blue), the G5 "white/grey with a green handle"
// (it is orange) and the Lifeline "white with an orange stripe" (it is
// yellow). A prompt that describes the wrong device fails good units or
// passes broken ones, so nothing goes in here that the manufacturer doesn't
// say. The two Physio-Control units have no verified description yet, so
// they get the generic guidance with only their name.
//
// A profile supplies the device-specific WHERE and WHAT for each checklist
// item; the device-neutral task and judging rules stay in
// lib/inspectionChecklist.js.

const PHILIPS_FRX = {
  id: "frx",
  name: "Philips HeartStart FRx",
  brand: "Philips",
  blinkingReady: true,
  readinessRetake:
    "We couldn't see the green Ready light flash. Film only the small Ready light (not the On/Off button), " +
    "up close and steady, for at least 10 seconds. If it never flashes, the AED needs attention.",
  appearance:
    "A rugged blue-grey Philips unit, wider than it is tall, usually kept in a carry case. Front: a green " +
    "On/Off button, a blue i-button that flashes when the unit needs attention, an orange Shock button, and a " +
    "small green Ready light. Back: the battery compartment and small white labels, one of them the serial number.",
  guidance: {
    pads_expiry_date:
      "The FRx uses HeartStart SMART Pads II: a grey plastic pads case on a cable that ends in a blue plug. The " +
      "expiration date is on the small white label near the bottom of the front of the case, beside an " +
      "hourglass symbol and under the words 'EXPIRATION DATE' (for example 2020-09), with the LOT number " +
      "beneath it. The case stays sealed until it is used.",
    battery_expiry_date:
      "The FRx uses the M5070A lithium battery: a blue pack that clicks into the compartment on the back of the " +
      "unit. Its label is often printed sideways and reads 'Install before' followed by the date (for example " +
      "'Install before 2022-12'). Philips says the battery must be installed before that date â€” it is the one " +
      "to report. A date beside a factory symbol is the manufacture date.",
    battery_attached:
      "The blue M5070A battery sits in the compartment on the back of the FRx. Correctly fitted, its bottom end " +
      "is seated first and its top (latch) end is pressed down until it clicks, so the battery lies flush with " +
      "the case. A raised latch end, a visible gap, a tilted battery or an empty compartment is a fail.",
    pads_connected:
      "The pads connector port is a small socket in the TOP-LEFT corner of the FRx's front face, above the dark " +
      "grey panel. Empty, it shows as a recessed slot with two small dark rectangular openings side by side, " +
      "and nothing comes out of it. Connected, a blue-grey plug fills that slot and a thin pads cable runs out " +
      "of it, towards the sealed SMART Pads II case (usually stored in the carry-case pocket, not on the unit). " +
      "Pass only if the plug and its cable are visible in the port. If you can see the two openings, or no plug " +
      "and cable at all, the pads are NOT connected â€” a fail. A loose or half-inserted plug is a fail.",
    readiness_indicator:
      "The FRx's Ready light is a small green light on the front, near but separate from the green On/Off " +
      "button. Never judge the On/Off button's colour: the button is green whether or not the unit is ready. " +
      "In standby a healthy FRx BLINKS its Ready light green, the flashes several seconds apart, so most frames " +
      "show it dark. Only a frame where the Ready light itself is visibly lit green shows it is ready; never " +
      "assume it flashed between frames. Solid green means it is in use or running a self-test. The Ready light " +
      "off, or a flashing blue i-button, means the FRx needs attention (a failed self-test, a pads problem, a " +
      "child key left installed, or low battery).",
  },
};

const PHILIPS_HS1 = {
  id: "hs1",
  name: "Philips HeartStart HS1 (OnSite)",
  brand: "Philips",
  blinkingReady: true,
  readinessRetake: PHILIPS_FRX.readinessRetake,
  referencePhoto: "readiness-hs1.jpg",
  appearance:
    "A rounded blue Philips unit with a grip on its left side and a clear pads cartridge with a green PULL " +
    "handle fitted in a well on the front. Front, right side: a small green Ready light in the upper right, a " +
    "green On/Off button, a blue i-button and an orange Shock button. Back: the battery recess and small white " +
    "labels, one of them the serial number.",
  guidance: {
    pads_expiry_date:
      "The HS1 uses a SMART Pads Cartridge: a clear plastic cartridge with a green PULL handle, fitted in the " +
      "cartridge well on the front of the unit. The expiry date is printed on a small label just below the body " +
      "diagram, beside an hourglass symbol (for example 2019/05), with the LOT number underneath. An " +
      "infant/child cartridge also carries a teddy-bear icon.",
    battery_expiry_date:
      "The HS1 uses the M5070A lithium battery: a blue pack inserted in the recess on the back. Its label is " +
      "often printed sideways and carries more than one date. Report the install-before date â€” marked by an " +
      "arrow pointing into a bracket or the words 'Install before' (for example 2028-12-31) â€” never the date " +
      "beside the factory symbol, which is when the battery was made.",
    battery_attached:
      "The blue M5070A battery sits in a recess on the back of the HS1 and should lie flush and latched, with no " +
      "gap or raised end. An empty recess, a tilted battery or a raised edge is a fail.",
    pads_connected:
      "On the HS1 the pads cartridge IS the connection â€” there is no separate cable to plug in. Pass if a pads " +
      "cartridge is fitted in the cartridge well on the front, clicked into place, with its green PULL handle " +
      "pushed all the way down. Fail if the well is empty, the cartridge sits raised or crooked, or the green " +
      "handle is pulled up (pulling it starts a rescue and opens the cartridge).",
    readiness_indicator:
      "The HS1's Ready light is a small green light in the upper right of the front, just above the green " +
      "On/Off button. Never judge the On/Off button's colour: it is green whether or not the unit is ready. In " +
      "standby a healthy HS1 BLINKS its Ready light green about once every 3 seconds, so most frames show it " +
      "dark. Only a frame where the Ready light itself is visibly lit green shows it is ready; never assume it " +
      "flashed between frames. Solid green means it is in use. The Ready light off, a flashing blue i-button or " +
      "chirping means the unit needs attention.",
  },
};

const ZOLL_AED_PLUS = {
  id: "zollPlus",
  name: "ZOLL AED Plus",
  brand: "ZOLL",
  readinessRetake:
    "We couldn't clearly see a green check in the status window. Film the window on the handle up close and " +
    "steady for about 5 seconds. A red X means the AED needs attention.",
  referencePhoto: "readiness-zoll-plus.jpg",
  appearance:
    "A bright lime-green ZOLL unit with a hinged cover and a moulded carry handle. Under the cover: a grey " +
    "panel of step pictograms, an optional small screen and the electrode connector. On the left of the handle " +
    "is the Status Indicator window; on the right, the power button. The battery compartment is on the back and " +
    "holds ten lithium 123 photo cells.",
  guidance: {
    pads_expiry_date:
      "The AED Plus uses CPR-D-padz (one-piece adult electrodes; Stat-padz II also exist), kept pre-connected " +
      "and folded under the unit's cover, supplied in a sealed pack that often comes in a white box. The expiry " +
      "date sits beside an hourglass symbol on the front label (for example 2022-12-28) and is repeated with the " +
      "LOT on the end of the box. A GS1 line such as '(17)221228' encodes the same expiry as YYMMDD.",
    battery_expiry_date:
      "The AED Plus runs on ten lithium 123 photo cells in a battery well on the back. The date that matters is " +
      "handwritten on the white 'REPLACE BATTERIES ON OR BEFORE:' label (battery-over-hourglass symbol) stuck " +
      "just below the Status Indicator window on the handle â€” report that date. A ZOLL battery pack's own label " +
      "may show an 'Install before' date: its shelf life before fitting. The date printed on each individual " +
      "cell (Duracell 'YYYY/MM', or 'MMYY') is the cell's MANUFACTURE date according to ZOLL â€” never report it " +
      "as the expiry. If a cell date is the only date visible, set expiry_date=null and passed=false, and ask " +
      "for a photo of the 'Replace batteries on or before' label below the status window.",
    battery_attached:
      "The battery compartment is on the back, under a cover. With the cover off, all ten 123 cells should be " +
      "seated in the battery well, correctly oriented, none missing. With the cover on, pass if it is closed and " +
      "latched flush, and note that the cells themselves were not visible. An empty well, a missing cell or a " +
      "loose cover is a fail.",
    pads_connected:
      "The electrodes must be pre-connected: their cable plugs into the electrode connector on the unit, under " +
      "the cover beside the pictogram panel, with the pads folded inside the cover. Pass only if the plug is " +
      "fully seated in the connector. An empty socket or a loose plug is a fail â€” ZOLL notes the unit fails its " +
      "self-test and shows a red X when the electrodes are not connected.",
    readiness_indicator:
      "The AED Plus has NO blinking ready light. Its Status Indicator is a small window on the LEFT side of the " +
      "carry handle that shows a symbol: a GREEN CHECK MARK means the unit passed its last self-test and is " +
      "ready for use; a RED X means it failed and is not ready. The green check is normally steady â€” a steady " +
      "green check through the clip is a PASS (status='ready'); never fail it for not blinking. A red X is a " +
      "fault (status='fault') â€” except for the first 4-5 seconds after the unit is switched on, when the window " +
      "shows a red X before changing to the check, which is normal. If the window can't be seen or read, " +
      "status='unclear'.",
  },
};

// The orange Powerheart G5 in the model picker, sold as Cardiac Science and,
// since ZOLL bought the line, as ZOLL.
const POWERHEART_G5 = {
  id: "g5",
  name: "Cardiac Science (ZOLL) Powerheart G5",
  brand: "Cardiac Science",
  brandAliases: ["ZOLL"],
  // Its Intellisense battery carries no expiry, only a manufacture date, and
  // is guaranteed for 4 years from installation â€” see dateBatteryByAge.
  batteryLifeMonths: 48,
  readinessRetake:
    "We couldn't clearly see the Rescue Ready indicator showing green. With the lid closed, film the round " +
    "indicator beside the handle, up close and steady, for about 10 seconds. If it stays red, the AED needs " +
    "attention.",
  referencePhoto: "readiness-g5.jpg",
  appearance:
    "An upright, orange Powerheart G5 (Cardiac Science or ZOLL) with a grey carry handle and a lid. The front " +
    "of the lid has a large AED heart graphic and a small window, marked YEAR/MM, showing the pads' expiry " +
    "date. The round Rescue Ready indicator is at the top right, beside the handle. Under the lid: the pads in " +
    "their holders, the pad socket, and a display panel with battery, pads and service lights. The battery " +
    "fits into the bottom of the unit.",
  guidance: {
    pads_expiry_date:
      "The G5's pads (XELAED001 adult, XELAED002 adult with CPR feedback device, XELAED003 paediatric) come in a " +
      "sealed package kept in the lid. The pads' expiry date shows through the expiration window on the front of " +
      "the lid (marked YEAR/MM) and is printed beside the hourglass symbol on the package. A date beside a " +
      "factory symbol is the manufacture date.",
    battery_expiry_date:
      "The G5's Intellisense lithium battery (XBTAED001) fits into the bottom of the unit. It carries NO expiry " +
      "date: its label shows the date it was MANUFACTURED (factory symbol). ZOLL guarantees it for 4 years from " +
      "installation, with a 5-year shelf life before installation. Put that date in manufacture_date and leave " +
      "expiry_date null â€” the app works out the replacement date. If an installation date has been written on " +
      "the battery or a sticker on it, put it in install_date. These notes override the general date rules " +
      "above: on this battery the manufacture date IS the date to read, a missing expiry is normal, and notes " +
      "must never ask the inspector to find one. Set date_legible=true only if you read the manufacture date " +
      "with certainty.",
    battery_attached:
      "The battery fits into the compartment in the BOTTOM of the G5: it is lowered in and pressed down until it " +
      "clicks, and its tab latches. Correctly fitted it is flush with the case. An empty compartment, a battery " +
      "sitting raised or crooked, or a gap is a fail. With the lid open, a red battery light on the display " +
      "panel means the battery is low.",
    pads_connected:
      "The adult pads must be pre-connected: the package sits in the pad package holders under the lid and its " +
      "connector plugs into the pad socket. Pass only if the connector is fully plugged in. With the lid open, a " +
      "lit pads indicator on the display panel means the pads are not connected or not usable â€” a fail. An " +
      "empty socket or a loose connector is a fail.",
    readiness_indicator:
      "The G5 has NO blinking ready light. Its Rescue Ready indicator is the round window at the top right, " +
      "beside the handle, ringed by the words RESCUE READY. GREEN means the self-tests passed and it is Rescue " +
      "Ready: status='ready'; never fail it for not blinking. RED means it needs attention and is not ready: " +
      "status='fault'. Closing the lid runs a self-test during which the indicator turns red for a few seconds " +
      "and then back to green â€” red that turns green within the clip is normal and ready. Judge only this " +
      "indicator, never the orange case or a reflection. If it can't be seen or its colour read, " +
      "status='unclear'.",
  },
};

// The yellow Lifeline in the model picker. The Lifeline (DDU-100) and
// Lifeline AUTO (DDU-120) share every part these checks look at; the AUTO
// only swaps the SHOCK button for an "auto" symbol.
const DEFIBTECH_LIFELINE = {
  id: "defibtech",
  name: "Defibtech Lifeline / Lifeline AUTO AED (DDU-100 series)",
  brand: "Defibtech",
  blinkingReady: true,
  readinessRetake:
    "We couldn't see the status light flash green. Film the small light at the top-right corner, at the end of " +
    "the handle, up close and steady, for at least 10 seconds â€” it flashes about every 5 seconds. Red, or no " +
    "flash at all, means the AED needs attention.",
  referencePhoto: "readiness-defibtech.jpg",
  appearance:
    "A yellow Defibtech Lifeline AED with dark grey rubber sides and a dark carry handle across the top, " +
    "printed 'LIFELINE AED' (or 'Lifeline AUTO'). It has NO screen. Front: a green On/Off button, three small " +
    "lights labelled 'check pads', 'do not touch patient' and 'analyzing', a red triangular SHOCK button (on " +
    "the AUTO, a yellow 'auto' symbol with a lightning bolt instead) and a speaker grille. The pads connector " +
    "plugs in at the top-left corner, the small Active Status Indicator is at the top-right corner, the battery " +
    "pack slides into the side, and the sealed pads package sits in a holder on the back.",
  guidance: {
    pads_expiry_date:
      "The Lifeline uses Defibtech DDP-100 adult pads (DDP-200P for children), supplied in a sealed pouch with " +
      "the connector and part of the cable outside it, and stored in the pad holder on the back of the AED with " +
      "the pictures facing out. The expiry date is on the BACK of the pouch (the side facing into the holder): a " +
      "small white label with 'REF DDP-100', the LOT, the date beside the hourglass (use-by) symbol, " +
      "year-month-day, and a QR code with GS1 lines where '(17)YYMMDD' repeats the expiry. The pouch is slid out " +
      "of the holder to read it, still sealed and plugged in. The yellow adult pouch is printed 'ADULT ELECTRODE " +
      "PADS'. Defibtech pads last 2.5 years from manufacture, so a date beside the factory symbol is the " +
      "manufacture date, never the expiry.",
    battery_expiry_date:
      "The Lifeline runs on a yellow Defibtech lithium battery pack (DBP-1400, 5-year standby, or DBP-2800, " +
      "7-year) that slides into the opening in the SIDE of the unit, label facing up. Fitted, only its end " +
      "shows, so the label is read with the pack out: the battery eject button beside the opening pushes it " +
      "part-way out. The pack's expiration date is on its label, in a white box beside the hourglass (use-by) " +
      "symbol, above a barcode; a date beside the factory symbol is the manufacture date. The separate 'SN' box " +
      "below it is the battery's serial number, not a date. Inside the pack, under a small cover, is a separate " +
      "9V lithium battery that powers the status light: any date printed on that 9V battery is NOT the pack's " +
      "expiry â€” never report it. Newer packs also have their own small green light on the label side, blinking " +
      "while the pack is good; it is not a date and not the AED's status light.",
    battery_attached:
      "The battery pack slides into the opening in the SIDE of the Lifeline, next to the orange battery eject " +
      "button, until its latch clicks. Correctly fitted, the end of the pack is flush with the side of the case. " +
      "An empty opening (a rectangular slot you can see into, with the orange eject button beside it), a pack " +
      "sticking out, or a crooked pack is a fail.",
    pads_connected:
      "Defibtech designs the Lifeline to be stored with the pads pre-connected: the pads cable's connector plugs " +
      "into the pads connector port at the TOP-LEFT corner of the front, at the end of the carry handle, and the " +
      "sealed pads package sits in the holder on the back with its cable pressed into the groove. Pass only if " +
      "the connector is visibly seated in the port with its cable leading away. An empty port, or a loose or " +
      "half-inserted connector, is a fail â€” the AED would say 'Plug in pads connector'.",
    readiness_indicator:
      "The Lifeline's ready signal is its Active Status Indicator (ASI): a small light at the TOP-RIGHT corner " +
      "of the unit, at the right-hand end of the carry handle. Never judge the green On/Off button (it is lit " +
      "only while the unit is switched on), the three rescue lights on the front (check pads, do not touch " +
      "patient, analyzing) or the SHOCK button. In standby a healthy Lifeline FLASHES the ASI GREEN about once " +
      "every five seconds, so most frames show it dark. Only a frame where the ASI itself is visibly lit green " +
      "shows it is ready; never assume it flashed between frames. Flashing RED, usually with a periodic beep, " +
      "means it needs attention: status='fault'. An ASI that never lights means the battery pack, or the 9V " +
      "battery inside it that powers the light, is flat or missing â€” the AED needs attention. Steady green means " +
      "it is switched on. If the corner can't be seen, status='unclear'.",
  },
};

const GENERIC_GUIDANCE = {
  readiness_indicator:
    "AEDs show readiness in different ways: a small green light that blinks in standby (Philips and others), a " +
    "status window with a green check/tick (ZOLL), or a Rescue Ready indicator that is green or red (Cardiac " +
    "Science Powerheart). A red light, a red X, a blank status window, a flashing service or i-button, or " +
    "chirping means the unit is not ready.",
};

const GENERIC = {
  id: "generic",
  name: "an automated external defibrillator (AED) whose make and model were not given",
  appearance: "Identify the make and model from the image if you can, and mention it in notes. Do not assume a particular brand's layout.",
  guidance: GENERIC_GUIDANCE,
  readinessRetake:
    "We couldn't clearly see the AED's ready signal. Film the readiness indicator up close and steady for at " +
    "least 10 seconds.",
};

// Known by name only: the brand check still works, but nothing about their
// layout is asserted until it can be taken from Physio-Control's manuals.
function namedGeneric(id, name) {
  return {
    ...GENERIC,
    id,
    name,
    brand: "Physio-Control",
    appearance: `A ${name}. Identify its parts from what is actually visible; do not assume another brand's layout.`,
  };
}

const PROFILES = {
  frx: PHILIPS_FRX,
  hs1: PHILIPS_HS1,
  zollPlus: ZOLL_AED_PLUS,
  g5: POWERHEART_G5,
  defibtech: DEFIBTECH_LIFELINE,
  crPlus: namedGeneric("crPlus", "Physio-Control (Stryker) LIFEPAK CR Plus"),
  lp1000: namedGeneric("lp1000", "Physio-Control (Stryker) LIFEPAK 1000"),
};

// The profile for a model value as the form stores it ("frx"), or the
// generic one when the model is missing, "other" or unknown.
export function getDeviceProfile(model) {
  return (model && PROFILES[model]) || GENERIC;
}
