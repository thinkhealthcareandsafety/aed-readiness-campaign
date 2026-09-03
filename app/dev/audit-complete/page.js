import { notFound } from "next/navigation";
import AuditCompletePreviewClient from "./AuditCompletePreviewClient";

// Same local-only playground idea as /dev/prize-wheel next door: the audit
// completion seal only ever appears on the final review step, which
// otherwise means filling in all 14 steps (with a fresh email past the
// one-per-email gate) every single time you want to eyeball an animation
// tweak. Gated out of production so it never becomes a public page.
export const metadata = { robots: { index: false, follow: false } };

export default function AuditCompletePreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <AuditCompletePreviewClient />;
}
