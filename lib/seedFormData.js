// Default form content — the original 40-question AED Readiness Audit,
// expressed as data so the admin Form Builder can edit every part of it.
// This only runs once, the first time the schema tables are empty.
import { HOTELS } from "./hotels";

const EXPIRY_OPTIONS = [
  { value: "gt2y", label: "More than 2 years", points: 7 },
  { value: "1to2y", label: "Between 1-2 years", points: 6 },
  { value: "gt6m", label: "More than 6 months", points: 5 },
  { value: "within6m", label: "Within next 6 months", points: 4 },
  { value: "within1m", label: "Within the next month", points: 3 },
  { value: "within1w", label: "Within the next week", points: 2 },
  { value: "expired", label: "Expired", points: 1 },
];

const YES_NO = (yesPoints, noPoints, yesLabel = "Yes", noLabel = "No", yesImg, noImg) => [
  { value: "yes", label: yesLabel, points: yesPoints, imageUrl: yesImg },
  { value: "no", label: noLabel, points: noPoints, imageUrl: noImg },
];

export function buildSeedSections() {
  return [
    {
      letter: "1",
      title: "General & Hotel Details",
      note: "Unscored — identity and routing.",
      isSupplementary: false,
      unscored: true,
      questions: [
        {
          type: "select",
          label: "Select your hotel",
          required: true,
          fieldRole: "hotel",
          options: [
            ...HOTELS.filter((h) => h !== "Other").map((h) => ({ value: h, label: h, points: 0 })),
            { value: "Other", label: "Other", points: 0, allowFreeText: true },
          ],
        },
        { type: "text", label: "Enter your first name", required: true, fieldRole: "first_name" },
        { type: "text", label: "Enter your last name", required: true, fieldRole: "last_name" },
        { type: "email", label: "Enter the primary email address", required: true, fieldRole: "email" },
        { type: "tel", label: "Enter your phone number", required: true, fieldRole: "phone" },
      ],
    },
    {
      letter: "2",
      title: "AED Status Gate",
      note: "Do you have AEDs installed?",
      isSupplementary: true,
      unscored: true,
      questions: [
        {
          type: "radio",
          label: "Do you have AEDs installed in your hotel?",
          required: true,
          fieldRole: "has_aed_gate",
          options: YES_NO(0, 0, "Yes", "No", "/reference/aed-cabinet-ready.jpg", "/reference/aed-cabinet-not-installed.jpg"),
        },
      ],
    },
    {
      letter: "2",
      title: "AED Status",
      note: "Inventory of installed units.",
      isSupplementary: true,
      visibleIfValue: "yes", // resolved against the has_aed_gate question at seed time
      questions: [
        {
          type: "select",
          label: "Select the number of AEDs installed",
          required: true,
          isCountLink: true, // resolved into a self-reference after insert, for max-selections linking
          options: Array.from({ length: 10 }, (_, i) => ({
            value: String(i + 1),
            label: String(i + 1),
            points: i === 0 ? 3 : 5,
          })),
        },
        {
          type: "quantity",
          label: "Select your AED model(s) from the options below",
          hint: "Use + / − to count each unit — two of the same model is fine. Match by casing colour and shape, not just the name.",
          required: true,
          maxSelectionsLinkedToPrevious: true,
          options: [
            { value: "frx", label: "Philips FRX AED", points: 1, imageUrl: "/aed-models/frx.jpg" },
            { value: "hs1", label: "Philips HS1 Onsite AED", points: 1, imageUrl: "/aed-models/hs1.jpg" },
            { value: "zollPlus", label: "Zoll AED Plus", points: 1, imageUrl: "/aed-models/zoll-plus.jpg" },
            { value: "g5", label: "Cardiac Science G5 AED", points: 1, imageUrl: "/aed-models/cardiac-g5.jpg" },
            { value: "defibtech", label: "Defibtech AED", points: 1, imageUrl: "/aed-models/defibtech.jpg" },
            { value: "crPlus", label: "Physio-Control CR Plus", points: 1, imageUrl: "/aed-models/physio-cr-plus.jpg" },
            { value: "lp1000", label: "Physio-Control LP 1000", points: 1, imageUrl: "/aed-models/physio-lp1000.jpg" },
            { value: "other", label: "Other / unlisted model", sub: "Not pictured above", points: 1, imageUrl: "/icons/model-other.svg", allowFreeText: true },
          ],
        },
        // Serial numbers live here, right alongside count/model, instead of
        // deep in the later Expiry Status section — registering exactly
        // which physical units exist (count + model + serial) is one task,
        // separate from what condition each one is in.
        { type: "text", label: "Enter the serial number of AED (1)", required: true, fieldRole: "serial_number_1" },
        { type: "text", label: "Enter the serial number of AED (2)", required: false, fieldRole: "serial_number_2" },
      ],
    },
    {
      letter: "P",
      title: "Physical Status",
      note: "Scored on every reported AED unit — not just the first.",
      isSupplementary: false,
      visibleIfValue: "yes",
      questions: [
        // Unit (1) — always asked, always scored.
        { type: "radio", label: "Is the battery (1) installed correctly?", required: true, fieldRole: "battery_attached", options: YES_NO(5, 0, "Yes", "No", "/reference/frx-battery-attached.jpg", "/reference/frx-battery-not-attached.jpg") },
        { type: "radio", label: "Are the pads (1) connected and sealed?", required: true, hint: "The pouch should lie flat with an unbroken seal — a curled or air-gapped edge means the pads have been exposed.", fieldRole: "pads_connected", options: YES_NO(5, 0, "Yes", "No", "/reference/frx-pads-connected.jpg", "/reference/frx-pads-not-connected.jpg") },
        { type: "radio", label: "Is there any visible damage on AED (1) (cracks, swelling, or leakage)?", required: true, options: YES_NO(0, 3, "Yes", "No, good condition", "/reference/damage-examples.jpg", "/icons/damage-no.svg") },
        { type: "radio", label: "Is the AED (1) cabinet intact and accessible?", required: true, fieldRole: "aed_cabinet_ok", options: YES_NO(2, 0, "Yes", "No", "/reference/aed-cabinet-example.jpg", "/reference/aed-cabinet-not-installed.jpg") },
        // Unit (2) template — expandUnitQuestions (lib/genericScoring.js)
        // clones this block per additional reported unit, forcing each
        // clone required+scored the moment the responder says that unit
        // exists. A second AED with a broken battery or missing pads used
        // to be invisible to this form entirely — every property only ever
        // reported ONE physical-condition answer no matter how many AEDs it
        // actually had.
        { type: "radio", label: "Is the battery (2) installed correctly?", required: false, unscored: true, fieldRole: "battery_attached_2", options: YES_NO(5, 0, "Yes", "No", "/icons/battery-ok.svg", "/icons/battery-bad.svg") },
        { type: "radio", label: "Are the pads (2) connected and sealed?", required: false, unscored: true, fieldRole: "pads_connected_2", options: YES_NO(5, 0, "Yes", "No", "/icons/pads-sealed.svg", "/icons/pads-unsealed.svg") },
        { type: "radio", label: "Is there any visible damage on AED (2) (cracks, swelling, or leakage)?", required: false, unscored: true, options: YES_NO(0, 3, "Yes", "No, good condition", "/reference/damage-examples.jpg", "/icons/damage-no.svg") },
        { type: "radio", label: "Is the AED (2) cabinet intact and accessible?", required: false, unscored: true, fieldRole: "aed_cabinet_ok_2", options: YES_NO(2, 0, "Yes", "No", "/reference/aed-cabinet-installed.jpg", "/reference/aed-cabinet-not-installed.jpg") },
      ],
    },
    {
      letter: "R",
      title: "Readiness Alert on AED",
      note: "Status-light literacy, scored on every reported unit — look at the device, not just the manual.",
      isSupplementary: false,
      visibleIfValue: "yes",
      questions: [
        {
          type: "radio",
          label: "Is AED (1) displaying a green (ready) indicator?",
          required: true,
          hint: "Steady or slow-blinking green means ready. Red, orange, or fast-blinking amber means it needs attention.",
          fieldRole: "readiness_indicator",
          options: [
            { value: "green", label: "Green / Ready", sub: "Steady or slow-blinking", points: 3, imageUrl: "/reference/frx-status-ready.jpg" },
            { value: "red", label: "Red / Orange / Not ready", sub: "Fast-blinking or solid warning colour", points: 0, imageUrl: "/reference/frx-status-notready.jpg" },
          ],
        },
        { type: "radio", label: "Is there any warning beep or error message on AED (1)?", required: true, options: [{ value: "no", label: "No — no warning beep or error", points: 3, imageUrl: "/icons/beep-no.svg" }, { value: "yes", label: "Yes — warning beep or error present", points: 0, imageUrl: "/icons/beep-yes.svg" }] },
        {
          type: "radio",
          label: "Self-test (1) passed (if display available)?",
          required: true,
          options: [
            { value: "passed", label: "Self-test passed", points: 4, imageUrl: "/icons/selftest-pass.svg" },
            { value: "nodisplay", label: "No digital display on this model", points: 2, imageUrl: "/icons/selftest-nodisplay.svg" },
            { value: "failed", label: "Self-test failed", points: 0, imageUrl: "/icons/selftest-fail.svg" },
          ],
        },
        // Unit (2) template — same cloning mechanism as Physical Status
        // above and Expiry Status below.
        {
          type: "radio",
          label: "Is AED (2) displaying a green (ready) indicator?",
          required: false,
          unscored: true,
          fieldRole: "readiness_indicator_2",
          options: [
            { value: "green", label: "Green / Ready", sub: "Steady or slow-blinking", points: 3, imageUrl: "/reference/frx-status-ready.jpg" },
            { value: "red", label: "Red / Orange / Not ready", sub: "Fast-blinking or solid warning colour", points: 0, imageUrl: "/reference/frx-status-notready.jpg" },
          ],
        },
        { type: "radio", label: "Is there any warning beep or error message on AED (2)?", required: false, unscored: true, options: [{ value: "no", label: "No — no warning beep or error", points: 3, imageUrl: "/icons/beep-no.svg" }, { value: "yes", label: "Yes — warning beep or error present", points: 0, imageUrl: "/icons/beep-yes.svg" }] },
        {
          type: "radio",
          label: "Self-test (2) passed (if display available)?",
          required: false,
          unscored: true,
          options: [
            { value: "passed", label: "Self-test passed", points: 4, imageUrl: "/icons/selftest-pass.svg" },
            { value: "nodisplay", label: "No digital display on this model", points: 2, imageUrl: "/icons/selftest-nodisplay.svg" },
            { value: "failed", label: "Self-test failed", points: 0, imageUrl: "/icons/selftest-fail.svg" },
          ],
        },
      ],
    },
    {
      letter: "E",
      title: "Expiry Status",
      note: "Scored on every reported AED unit — not just the first.",
      isSupplementary: false,
      visibleIfValue: "yes",
      questions: [
        { type: "date", label: "Select Battery (1) Shelf Life Expiry Date", required: true, hint: "Example: 7 January 2029", fieldRole: "battery_expiry_date_1" },
        { type: "radio", label: "Battery (1) expiry status", required: true, derivedFromPreviousDate: true, options: EXPIRY_OPTIONS },
        { type: "date", label: "Electrode Pad (1) Shelf Life Expiry Date", required: true, hint: "Example: 7 January 2029", fieldRole: "pads_expiry_date_1" },
        { type: "radio", label: "Electrode Pads (1) expiry status", required: true, derivedFromPreviousDate: true, options: EXPIRY_OPTIONS },
        { type: "date", label: "Select Battery (2) Shelf Life Expiry Date", required: false, fieldRole: "battery_expiry_date_2" },
        { type: "radio", label: "Battery (2) expiry status", required: false, unscored: true, derivedFromPreviousDate: true, options: EXPIRY_OPTIONS },
        { type: "date", label: "Electrode Pad (2) Shelf Life Expiry Date", required: false, fieldRole: "pads_expiry_date_2" },
        { type: "radio", label: "Electrode Pads (2) expiry status", required: false, unscored: true, derivedFromPreviousDate: true, options: EXPIRY_OPTIONS },
      ],
    },
    {
      letter: "P",
      title: "Paediatric Readiness",
      note: "Any paediatric option earns full credit.",
      isSupplementary: false,
      visibleIfValue: "yes",
      questions: [
        {
          type: "radio",
          label: "Is there a Paediatric Pad or Infant/Child Key?",
          required: true,
          options: [
            { value: "pads", label: "Paediatric pads", sub: "Smaller pad set, child artwork", points: 10, imageUrl: "/reference/paed-pads-zoll-photo.jpg" },
            { value: "key", label: "Child key", sub: "Physical key plugs into the case", points: 10, imageUrl: "/reference/paed-key-photo.jpg" },
            { value: "mode", label: "Paediatric mode", sub: "Adult/child toggle on the unit", points: 10, imageUrl: "/icons/paed-switch.svg" },
            { value: "no", label: "Adult option only", sub: "No paediatric provision", points: 0, imageUrl: "/icons/paed-adultonly.svg" },
          ],
        },
      ],
    },
    {
      letter: "A",
      title: "AED Responder Training",
      note: "Recency and reach of the last training session.",
      isSupplementary: false,
      visibleIfValue: "yes",
      questions: [
        {
          type: "radio",
          label: "When was AED Responder training last conducted?",
          required: true,
          fieldRole: "training_recency",
          options: [
            { value: "12", label: "Within last 12 months", points: 10, imageUrl: "/icons/training-recent.svg" },
            { value: "12-24", label: "12-24 months ago", points: 6, imageUrl: "/icons/training-1224.svg" },
            { value: "24-36", label: "24-36 months ago", points: 3, imageUrl: "/icons/training-2436.svg" },
            { value: "over36", label: "More than 36 months / never", points: 0, imageUrl: "/icons/training-never.svg" },
          ],
        },
        {
          type: "select",
          label: "How many people were trained in the last session?",
          required: true,
          fieldRole: "training_headcount",
          options: [
            { value: "0-15", label: "0-15", points: 1 },
            { value: "15-30", label: "15-30", points: 2 },
            { value: "30-50", label: "30-50", points: 3 },
            { value: "50-100", label: "50-100", points: 4 },
            { value: "100+", label: "100+", points: 5 },
          ],
        },
      ],
    },
    {
      letter: "R",
      title: "Regular Inspection",
      note: "How maintenance is tracked.",
      isSupplementary: false,
      visibleIfValue: "yes",
      questions: [
        {
          type: "radio",
          label: "Do you use any software to track AED maintenance and inspections?",
          required: true,
          options: [
            { value: "plustrack", label: "Yes — Plus Track", points: 5, imageUrl: "/icons/track-app-a.svg" },
            { value: "aedsmartx", label: "Yes — AEDSMARTX", points: 5, imageUrl: "/icons/track-app-b.svg" },
            { value: "manual", label: "Yes — manual log / checklist register", points: 3, imageUrl: "/icons/track-manual.svg" },
            { value: "none", label: "None", points: 0, imageUrl: "/icons/track-none.svg" },
          ],
        },
      ],
    },
    {
      letter: "E",
      title: "Emergency Accessories & Contacts",
      note: "What's stocked with the unit, and who's listed on it.",
      isSupplementary: false,
      visibleIfValue: "yes",
      questions: [
        {
          type: "checkbox",
          label: "Which emergency accessories do you have with your AED?",
          required: true,
          options: [
            { value: "gloves", label: "Gloves", points: 1, imageUrl: "/accessories/gloves.jpg" },
            { value: "razor", label: "Razor", points: 1, imageUrl: "/accessories/razor.jpg" },
            { value: "scissors", label: "Scissors", points: 1, imageUrl: "/accessories/scissors.jpg" },
            { value: "wipes", label: "Wipes", points: 1, imageUrl: "/accessories/wipes.jpg" },
            { value: "mask", label: "CPR mask / soft stretcher", points: 1, imageUrl: "/accessories/mask.jpg" },
          ],
        },
        {
          type: "checkbox",
          label: "Which emergency contact number is mentioned on your AED?",
          required: true,
          options: [
            { value: "ambulance", label: "Ambulance (108)", sub: "Local emergency line", points: 2, imageUrl: "/icons/contact-ambulance.svg" },
            { value: "hospital", label: "Nearest hospital", points: 1, imageUrl: "/icons/contact-hospital.svg" },
            { value: "lossPrevention", label: "Loss Prevention / Security", points: 1, imageUrl: "/icons/contact-security.svg" },
            { value: "doctor", label: "Doctor on call", points: 1, imageUrl: "/icons/contact-doctor.svg" },
          ],
        },
      ],
    },
    {
      letter: "D",
      title: "Documentation",
      note: "Records kept on file.",
      isSupplementary: false,
      visibleIfValue: "yes",
      questions: [
        {
          type: "checkbox",
          label: "Which documentation do you maintain periodically?",
          required: true,
          options: [
            { value: "maintenance", label: "AED maintenance records", points: 2, imageUrl: "/icons/doc-maintenance.svg" },
            { value: "training", label: "Training records", points: 2, imageUrl: "/icons/doc-training.svg" },
            { value: "eap", label: "Emergency action plan documentation", points: 1, imageUrl: "/icons/doc-eap.svg" },
          ],
        },
      ],
    },
    {
      letter: "✚",
      title: "Good Samaritan & CPR Awareness",
      note: "Your own readiness — this is what the Good Samaritan Warrior certificate is based on.",
      isSupplementary: true,
      questions: [
        { type: "radio", label: "Are you trained in CPR?", required: true, gateRole: "certificate", gateValue: "yes", options: YES_NO(2, 0, "Yes", "No", "/icons/cpr-yes.svg", "/icons/cpr-no.svg") },
        { type: "radio", label: "Are you trained to operate an AED?", required: true, gateRole: "certificate", gateValue: "yes", options: YES_NO(2, 0, "Yes", "No", "/icons/aed-trained-yes.svg", "/icons/aed-trained-no.svg") },
        { type: "radio", label: "Are you confident of using AED and performing CPR during an emergency?", required: true, options: YES_NO(2, 0, "Yes", "No", "/icons/confident-yes.svg", "/icons/confident-no.svg") },
        {
          type: "radio",
          label: "What is the minimum chest compression required for an adult?",
          required: true,
          options: [
            { value: "5cm", label: "At least 5 cm", points: 2, imageUrl: "/icons/compression-5cm.svg" },
            { value: "3-4cm", label: "3-4 cm", points: 0, imageUrl: "/icons/compression-34cm.svg" },
            { value: "lt3cm", label: "Less than 3 cm", points: 0, imageUrl: "/icons/compression-lt3cm.svg" },
          ],
        },
        {
          type: "radio",
          label: "Which age range is considered a child in CPR?",
          required: true,
          options: [
            { value: "18+", label: "18+ years", points: 0, imageUrl: "/icons/child-18plus.svg" },
            { value: "1-8", label: "1-8 years", points: 2, imageUrl: "/icons/child-1to8.svg" },
            { value: "lt1", label: "Less than 1 year", points: 0, imageUrl: "/icons/child-lt1.svg" },
          ],
        },
        { type: "scale", label: "How confident are you in performing Quality CPR?", required: true, scaleMin: 1, scaleMax: 5, scaleMinLabel: "Not confident", scaleMaxLabel: "Very confident" },
        { type: "scale", label: "How confident are you in using an AED?", required: false, scaleMin: 1, scaleMax: 5, scaleMinLabel: "Not confident", scaleMaxLabel: "Very confident" },
      ],
    },
  ];
}
