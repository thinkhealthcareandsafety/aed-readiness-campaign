import { NextResponse } from "next/server";
import { getSubmission, saveDeliveryAddress } from "@/lib/db";
import { prizeRequiresDelivery } from "@/lib/prizes";
import { isValidPersonName } from "@/lib/genericScoring";

const REQUIRED_FIELDS = ["name", "address1", "city", "state", "postalCode", "country"];
const INDIA_POSTAL_RE = /^[1-9][0-9]{5}$/;

export async function POST(request, { params }) {
  const { id } = await params;
  const submission = await getSubmission(id);
  if (!submission) return NextResponse.json({ error: "Submission not found" }, { status: 404 });
  if (!prizeRequiresDelivery(submission.prize)) {
    return NextResponse.json({ error: "This submission didn't win a prize that needs delivery." }, { status: 400 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  for (const field of REQUIRED_FIELDS) {
    if (!String(body?.[field] || "").trim()) {
      return NextResponse.json({ error: `${field} is required.` }, { status: 400 });
    }
  }
  if (!isValidPersonName(body.name)) {
    return NextResponse.json({ error: "Enter a valid name (letters only)." }, { status: 400 });
  }
  if (body.country.trim() === "India" && !INDIA_POSTAL_RE.test(body.postalCode.trim())) {
    return NextResponse.json({ error: "Enter a valid 6-digit PIN code." }, { status: 400 });
  }

  await saveDeliveryAddress(id, {
    name: body.name.trim(),
    address1: body.address1.trim(),
    address2: (body.address2 || "").trim(),
    city: body.city.trim(),
    state: body.state.trim(),
    postalCode: body.postalCode.trim(),
    country: body.country.trim(),
    notes: (body.notes || "").trim(),
  });

  return NextResponse.json({ ok: true });
}
