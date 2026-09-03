import { NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/adminAuth";
import { getFormSchema, getAllQuestionsFlat } from "@/lib/db";

export async function GET() {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const schema = await getFormSchema();
  const questionsFlat = await getAllQuestionsFlat();
  return NextResponse.json({ schema, questionsFlat });
}
