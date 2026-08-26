// Single source of truth for the post-submission spin-to-win reward, shared
// by the server (POST /api/submissions picks one at random — see
// app/api/submissions/route.js) and the client (components/PrizeWheel.jsx
// renders these same 5 slices). Order matters: it fixes each prize's slice
// position on the wheel, which the server's random index must agree with.
//
// Colors are drawn from the app's own brand palette (--structure/--accent/
// --ink in app/globals.css), not an unrelated gold-casino jewel-tone set —
// a "wheel of fortune" aesthetic bolted onto an otherwise restrained
// editorial-serif healthcare-audit tool read as a jarring, cheaper detour
// rather than premium, no matter how well the casino styling itself was
// executed. Fixed hex (not theme variables) so the reveal still reads the
// same regardless of the site's light/dark theme, same reasoning as
// before — just sourced from the brand's own light-theme values instead of
// invented gold/jewel tones.
export const PRIZES = [
  { id: "pads", label: "Replacement electrode pads", icon: "🩹", image: "/icons/prize-pads.svg", color: "#2f5d5a" },
  { id: "battery", label: "AED battery pack", icon: "🔋", image: "/icons/prize-battery.svg", color: "#1c2430" },
  { id: "stretcher", label: "Folding rescue stretcher", icon: "🛏️", image: "/icons/prize-stretcher.svg", color: "#dcd6c8" },
  { id: "first_aid_kit", label: "Fast Response Kit", icon: "🧰", image: "/icons/prize-first-aid.svg", color: "#a6540f" },
  { id: "aedsmartx", label: "AEDSmartX subscription", icon: "📲", image: "/icons/prize-subscription.svg", color: "#1e3f3d" },
];

export function prizeLabel(id) {
  return PRIZES.find((p) => p.id === id)?.label || null;
}
