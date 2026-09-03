import { NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/adminAuth";
import { updateSection, deleteSection } from "@/lib/db";

export async function PATCH(request, { params }) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  await updateSection(id, body);
  return NextResponse.json({ ok: true });
}

export async function DELETE(request, { params }) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  await deleteSection(id);
  return NextResponse.json({ ok: true });
}
