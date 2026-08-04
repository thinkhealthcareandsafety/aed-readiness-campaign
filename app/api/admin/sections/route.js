import { NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/adminAuth";
import { createSection } from "@/lib/db";

export async function POST(request) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const id = createSection({
    title: body.title || "New section",
    letter: body.letter || "",
    note: body.note || "",
    isSupplementary: !!body.isSupplementary,
    unscored: !!body.unscored,
  });
  return NextResponse.json({ id }, { status: 201 });
}
