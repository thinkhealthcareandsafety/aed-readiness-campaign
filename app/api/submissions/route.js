import crypto from "crypto";
import { NextResponse } from "next/server";
import { insertSubmission, listSubmissions, getFormSchema, getSubmissionByEmail } from "@/lib/db";
import { scoreSubmission, extractIdentity, validateAnswers, resolveDerivedAnswers, expandUnitQuestions, reconcileLinkedSelections } from "@/lib/genericScoring";
import { isAdminAuthed } from "@/lib/adminAuth";
import { PRIZES } from "@/lib/prizes";

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

  // Mirror the wizard's own schema transform before validating/scoring —
  // without this, a responder who reported 3+ AEDs would have their extra
  // units' answers (required and scored client-side) silently ignored here,
  // since those unit blocks only ever existed as the wizard's in-memory
  // clones and were never re-derived server-side.
  const baseSchema = getFormSchema();
  // Same self-heal as the wizard's own setAnswers: a stale client (an old
  // localStorage draft from before this existed, or a client that skipped
  // the UI entirely) could submit a quantity/checkbox answer that's over
  // its own linked question's limit — trim it back down here too, not just
  // client-side, before it drives how many unit blocks get expanded below.
  const reconciledAnswers = reconcileLinkedSelections(baseSchema, rawAnswers);
  const schema = expandUnitQuestions(baseSchema, reconciledAnswers);
  // Recompute date-derived answers (e.g. expiry tier) server-side too, so a
  // stale or tampered client value can never override the date that was
  // actually entered.
  const answers = resolveDerivedAnswers(schema, reconciledAnswers);
  const validationError = validateAnswers(schema, answers);
  if (validationError) {
    return NextResponse.json({ error: validationError.message }, { status: 400 });
  }

  const scored = scoreSubmission(schema, answers);
  const identity = extractIdentity(schema, answers);

  // The real one-entry-per-email boundary — app/api/submissions/check-email
  // is only a courtesy early-warning the client can skip entirely, so this
  // is the check that actually matters. No await happens between this read
  // and the insert below, so there's no race window within a single
  // request; the email column's UNIQUE index (lib/db.js) is the
  // defense-in-depth backstop beyond that.
  if (getSubmissionByEmail(identity.email)) {
    return NextResponse.json({ error: "This email has already completed an audit." }, { status: 409 });
  }

  // Decided once, here, server-side, and never re-rollable — there is no
  // separate "spin" endpoint. The client only ever plays back whichever
  // prize this response actually contains. Only a property that actually
  // reported an installed AED is eligible — the campaign's reward is for
  // maintaining a unit, not for filling out the form, so a "no AED
  // installed" response never wins anything (prize stays null and the
  // wizard skips the wheel entirely — see AuditWizard.jsx's submit()).
  const prize = identity.hasAED === "yes" ? PRIZES[crypto.randomInt(PRIZES.length)].id : null;

  const id = insertSubmission({ answers, scored, identity, prize });
  return NextResponse.json({ id, prize }, { status: 201 });
}

export async function GET() {
  const authed = await isAdminAuthed();
  if (!authed) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const rows = listSubmissions();
  return NextResponse.json({ submissions: rows });
}
