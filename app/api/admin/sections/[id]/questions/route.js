import { NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/adminAuth";
import { createQuestion } from "@/lib/db";

export async function POST(request, { params }) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const questionId = createQuestion(Number(id), {
    type: body.type || "radio",
    label: body.label || "New question",
    required: !!body.required,
  });
  return NextResponse.json({ id: questionId }, { status: 201 });
}
