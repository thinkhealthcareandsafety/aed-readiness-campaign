import { NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/adminAuth";
import { createOption } from "@/lib/db";

export async function POST(request, { params }) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const optionId = await createOption(id, {
    value: body.value || `opt-${Date.now()}`,
    label: body.label || "New option",
    points: body.points || 0,
  });
  if (!optionId) return NextResponse.json({ error: "Question not found" }, { status: 404 });
  return NextResponse.json({ id: optionId }, { status: 201 });
}
