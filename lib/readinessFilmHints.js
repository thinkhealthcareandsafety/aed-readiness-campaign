// What to film for the readiness check, per AED model — shown over the live
// camera before recording. Kept apart from lib/aedDeviceProfiles.js (the
// server's full device notes) so the browser only downloads these lines.
// The wording follows each profile's readiness notes.
const HINTS = {
  frx: "Keep the small green Ready light near the On/Off button inside the circle — not the button itself.",
  hs1: "Keep the small green Ready light, just above the On/Off button, inside the circle — not the button.",
  zollPlus: "Keep the small status window on the left of the handle inside the circle — a green ✓ means ready.",
  g5: "With the lid closed, keep the round Rescue Ready light beside the handle inside the circle.",
  defibtech: "Keep the small light at the top-right corner, at the end of the handle, inside the circle. It flashes about every 5 seconds.",
};
const DEFAULT_HINT = "Keep the small status light or window inside the circle — not the power button.";

export function readinessFilmHint(model) {
  return `${HINTS[model] || DEFAULT_HINT} Hold steady for 10+ seconds.`;
}
