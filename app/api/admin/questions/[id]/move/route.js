import { NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/adminAuth";
import { moveQuestion } from "@/lib/db";

export async function POST(request, { params }) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const { direction } = await request.json().catch(() => ({}));
  await moveQuestion(id, direction);
  return NextResponse.json({ ok: true });
}
