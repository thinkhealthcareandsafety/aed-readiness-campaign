import { NextResponse } from "next/server";
import { insertSubmission, listSubmissions, getFormSchema } from "@/lib/db";
import { scoreSubmission, extractIdentity, validateAnswers, resolveDerivedAnswers } from "@/lib/genericScoring";
import { isAdminAuthed } from "@/lib/adminAuth";

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const rawAnswers = body?.answers;
  if (!rawAnswers || typeof rawAnswers !== "object") {
    return NextResponse.json({ error: "Invalid submission" }, { status: 400 });
  }

  const schema = getFormSchema();
  // Recompute date-derived answers (e.g. expiry tier) server-side too, so a
  // stale or tampered client value can never override the date that was
  // actually entered.
  const answers = resolveDerivedAnswers(schema, rawAnswers);
  const validationError = validateAnswers(schema, answers);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const scored = scoreSubmission(schema, answers);
  const identity = extractIdentity(schema, answers);
  const id = insertSubmission({ answers, scored, identity });
  return NextResponse.json({ id }, { status: 201 });
}

export async function GET() {
  const authed = await isAdminAuthed();
  if (!authed) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const rows = listSubmissions();
  return NextResponse.json({ submissions: rows });
}
