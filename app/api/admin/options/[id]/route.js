import { NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/adminAuth";
import { updateOption, deleteOption } from "@/lib/db";

export async function PATCH(request, { params }) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  updateOption(Number(id), body);
  return NextResponse.json({ ok: true });
}

export async function DELETE(request, { params }) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  deleteOption(Number(id));
  return NextResponse.json({ ok: true });
}
