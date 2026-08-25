// Single source of truth for the post-submission spin-to-win reward, shared
// by the server (POST /api/submissions picks one at random — see
// app/api/submissions/route.js) and the client (components/PrizeWheel.jsx
// renders these same 5 slices). Order matters: it fixes each prize's slice
// position on the wheel, which the server's random index must agree with.
// Fixed jewel-tone hex colors, not theme variables — the wheel is styled as
// a physical casino/prize-ticket object (gold rim, icon medallions) that
// reads the same regardless of the site's light/dark theme, the same way a
// real wheel doesn't repaint itself when the room lights dim.
export const PRIZES = [
  { id: "pads", label: "Replacement electrode pads", icon: "🩹", image: "/icons/prize-pads.svg", color: "#2f5d42" },
  { id: "battery", label: "AED battery pack", icon: "🔋", image: "/icons/prize-battery.svg", color: "#5c4632" },
  { id: "stretcher", label: "Folding rescue stretcher", icon: "🛏️", image: "/icons/prize-stretcher.svg", color: "#f2ead9" },
  { id: "first_aid_kit", label: "Fast Response Kit", icon: "🧰", image: "/icons/prize-first-aid.svg", color: "#7a1f2e" },
  { id: "aedsmartx", label: "AEDSmartX subscription", icon: "📲", image: "/icons/prize-subscription.svg", color: "#1f3557" },
];

export function prizeLabel(id) {
  return PRIZES.find((p) => p.id === id)?.label || null;
}
