// Single source of truth for the post-submission spin-to-win reward, shared
// by the server (POST /api/submissions picks one at random — see
// app/api/submissions/route.js) and the client (components/PrizeWheel.jsx
// renders these same 5 slices). Order matters: it fixes each prize's slice
// position on the wheel, which the server's random index must agree with.
export const PRIZES = [
  { id: "pads", label: "Replacement electrode pads", shortLabel: "Pads", icon: "🩹", image: "/icons/prize-pads.svg", color: "var(--accent)" },
  { id: "battery", label: "AED battery pack", shortLabel: "Battery", icon: "🔋", image: "/icons/prize-battery.svg", color: "var(--structure)" },
  { id: "stretcher", label: "Folding rescue stretcher", shortLabel: "Stretcher", icon: "🛏️", image: "/icons/prize-stretcher.svg", color: "var(--ready)" },
  { id: "first_aid_kit", label: "First-aid kit", shortLabel: "First Aid", icon: "🧰", image: "/icons/prize-first-aid.svg", color: "var(--warn)" },
  { id: "aedsmartx", label: "AEDSmartX subscription", shortLabel: "AEDSmartX", icon: "📲", image: "/icons/prize-subscription.svg", color: "var(--accent-deep)" },
];

export function prizeLabel(id) {
  return PRIZES.find((p) => p.id === id)?.label || null;
}
