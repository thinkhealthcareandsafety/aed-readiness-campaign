import { NextResponse } from "next/server";
import { getSubmissionByEmail } from "@/lib/db";
import { isValidEmail } from "@/lib/genericScoring";

// Early, courtesy-only check so a responder finds out their email has
// already been used *before* filling in 13 more steps, not after. This is
// NOT the real security boundary — POST /api/submissions re-checks and
// rejects independently, since a client could skip this call entirely.
// Deliberately returns only a boolean, never the matching submission id or
// any other detail, so this can't be used to enumerate/confirm identities.
export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const email = body?.email;
  if (!isValidEmail(email)) {
    return NextResponse.json({ taken: false });
  }

  const existing = await getSubmissionByEmail(email);
  return NextResponse.json({ taken: !!existing });
}
