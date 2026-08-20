import { NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/adminAuth";
import { deleteSubmission } from "@/lib/db";

export async function DELETE(request, { params }) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const deleted = deleteSubmission(id);
  if (!deleted) return NextResponse.json({ error: "Submission not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
