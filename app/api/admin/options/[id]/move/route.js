import { NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/adminAuth";
import { moveOption } from "@/lib/db";

export async function POST(request, { params }) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const { direction } = await request.json().catch(() => ({}));
  moveOption(Number(id), direction);
  return NextResponse.json({ ok: true });
}
