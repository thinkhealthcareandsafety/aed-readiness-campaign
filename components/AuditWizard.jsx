"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { QBlock, RadioGroup, CheckboxList, IconRadioGrid, IconCheckboxGrid, IconQuantityGrid, TextInput, Select, TabSelect, LinearScale, qblockLabelId } from "@/components/fields";
import { OptionImage, isPhotoUrl } from "@/components/OptionImage";
import { FieldReferencePhoto, ImageLightbox, referenceKindFor, unitNumberFromLabel, photoForModel } from "@/components/ReferenceGuide";
import AutoInspection from "@/components/AutoInspection";
import { HotelSelect } from "@/components/HotelSelect";
import { logoForHotel } from "@/lib/hotelBrands";
import Landing from "@/components/Landing";
import LiveScore from "@/components/LiveScore";
import PrizeWheel from "@/components/PrizeWheel";
import { CHECKLIST_ITEMS, fieldRoleFor } from "@/lib/inspectionChecklist";
import { sortHotelOptionsByCity } from "@/lib/hotelCities";
import { isSectionVisible, maxSelectionsFor, validateSection, questionMax, extractIdentity, resolveDerivedAnswers, expandUnitQuestions, reconcileLinkedSelections, getSelectedAedModels, getAedModelSequence, getModelLabelMap, scoreSubmission } from "@/lib/genericScoring";
import { aedAgeStatus, isValidAedSerialFormat, aedSerialFormatHint, aedSerialExample } from "@/lib/aedSerialDate";
import { COUNTRY_CODES, DEFAULT_COUNTRY_ISO, countryByIso, composePhoneValue, parsePhoneValueLenient, sanitizeLocalDigits } from "@/lib/phoneCountries";

const REVIEW_STEP = { id: "__review", letter: "✓", title: "Submit Audit", questions: [] };

// The battery_attached/pads_connected questions were seeded with one fixed
// pair of real Philips FRx photos (see lib/seedFormData.js) — correct for
// an FRx unit, actively wrong for any other reported model. Maps each
// "attached" reference-photo kind to its "not attached" sibling in
// MODEL_PHOTOS (ReferenceGuide.jsx) — used for a non-FRx unit's "No"
// answer once a model has its own real photo for that state (currently
// zollPlus; see the resolvedOptionImage below).
const NOT_ATTACHED_KIND = { batteryAttached: "batteryNotAttached", padsAttached: "padsNotAttached", readyIndicator: "notReadyIndicator" };
// Brand-agnostic line icons (the seed's own pre-photo defaults) — the
// final fallback when a model has neither a real "not attached" photo nor
// the seeded FRx one applies. Showing the FRx-specific "not attached"
// photo mislabeled as e.g. a Defibtech unit would be worse than a generic
// icon, not better.
const GENERIC_NOT_ATTACHED_ICON = { batteryAttached: "/icons/battery-bad.svg", padsAttached: "/icons/pads-unsealed.svg" };

// Only ever inserted right after the AED Status (registration) section —
// i.e. only when the responder has already confirmed they have an AED and
// registered it — see modeChoiceInsertIndex below, so auto-scan is never
// offered when there's nothing registered yet to point a camera at.
const MODE_CHOICE_STEP = {
  id: "__mode_choice",
  letter: "✦",
  title: "How would you like to complete this?",
  note: "Photograph your AED and let AI read the details, or answer each question yourself.",
  questions: [],
};

// A plain fetch() never times out on its own — on flaky hotel wifi a
// request can stall indefinitely with no error and no response, which
// previously left submit()/the early email check spinning ("Submitting...",
// "Checking...") forever with no way to recover short of reloading the
// whole 14-step form and losing the in-progress draft. AbortController
// turns a hang into an actual rejected promise the existing catch blocks
// already handle.
function fetchWithTimeout(url, options, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

// Same "_1" exception, "_N" convention as fieldRoleFor in
// lib/inspectionChecklist.js, kept local rather than imported from there
// since that module's fieldRoleFor is scoped to auto-inspection's own
// concept ids and deliberately excludes serial_number (see the comment at
// the top of lib/inspectionChecklist.js).
function serialFieldRoleFor(unit) {
  return unit === 1 ? "serial_number_1" : `serial_number_${unit}`;
}

function findQuestionByFieldRole(schema, role) {
  for (const s of schema.sections) {
    for (const q of s.questions) {
      if (q.fieldRole === role) return q;
    }
  }
  return null;
}
