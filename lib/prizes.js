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
// requiresDelivery: false only for the subscription lead — nothing to
// ship, so the report's delivery-address prompt (see
// app/report/[id]/DeliveryAddressForm.jsx) never shows for it.
export const PRIZES = [
  { id: "pads", label: "Replacement electrode pads", icon: "🩹", image: "/prizes/pads.jpg", color: "#2f5d5a", requiresDelivery: true },
  { id: "battery", label: "AED battery pack", icon: "🔋", image: "/prizes/battery.jpg", color: "#1c2430", requiresDelivery: true },
  { id: "stretcher", label: "Folding rescue stretcher", icon: "🛏️", image: "/prizes/stretcher.jpg", color: "#dcd6c8", requiresDelivery: true },
  { id: "first_aid_kit", label: "Fast Response Kit", icon: "🧰", image: "/prizes/first-aid.jpg", color: "#a6540f", requiresDelivery: true },
  { id: "aedsmartx", label: "AEDSmartX subscription", icon: "📲", image: "/prizes/subscription.jpg", color: "#1e3f3d", requiresDelivery: false },
];

export function prizeLabel(id) {
  return PRIZES.find((p) => p.id === id)?.label || null;
}

export function prizeRequiresDelivery(id) {
  return PRIZES.find((p) => p.id === id)?.requiresDelivery || false;
}
