import { notFound } from "next/navigation";
import { PRIZES } from "@/lib/prizes";
import PrizeWheelPreviewClient from "./PrizeWheelPreviewClient";

// Local-only playground for the post-submission spin reveal — lets you jump
// straight to /dev/prize-wheel and pick any prize instead of filling out
// the entire audit form (and getting a fresh email past the one-per-email
// gate) every time you want to eyeball a wheel tweak. Gated out of
// production so this never becomes a public shortcut around the real
// submission flow.
export const metadata = { robots: { index: false, follow: false } };

export default function PrizeWheelPreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <PrizeWheelPreviewClient prizes={PRIZES} />;
}
