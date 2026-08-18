import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { getChecklistItem } from "@/lib/inspectionChecklist";
import { analyzeChecklistItem } from "@/lib/inspectionGemini";

// Same persisted-volume convention as app/api/admin/upload/route.js — see
// app/api/uploads/[filename]/route.js for how these are served back out.
const uploadsDir = path.join(process.cwd(), "data", "uploads");

const MAX_FILE_BYTES = 6 * 1024 * 1024; // one photo, or one extracted video frame
const MAX_FILES = 20; // generous for the readiness-indicator frame sequence
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function POST(request) {
  const formData = await request.formData().catch(() => null);
  if (!formData) return NextResponse.json({ error: "Invalid form data" }, { status: 400 });

  const itemId = formData.get("itemId");
  if (typeof itemId !== "string" || !getChecklistItem(itemId)) {
    return NextResponse.json({ error: "Unknown checklist item" }, { status: 400 });
  }

  const files = formData.getAll("file").filter((f) => typeof f !== "string");
  if (!files.length) return NextResponse.json({ error: "No file provided" }, { status: 400 });
  if (files.length > MAX_FILES) return NextResponse.json({ error: "Too many frames" }, { status: 400 });
  for (const f of files) {
    if (f.size > MAX_FILE_BYTES) return NextResponse.json({ error: "File too large" }, { status: 400 });
    if (!ALLOWED_MIME.has(f.type)) return NextResponse.json({ error: "Unsupported file type" }, { status: 400 });
  }

  const buffers = await Promise.all(files.map(async (f) => Buffer.from(await f.arrayBuffer())));
  const media = buffers.map((buf, i) => ({ base64: buf.toString("base64"), mimeType: files[i].type }));

  let result;
  try {
    result = await analyzeChecklistItem(itemId, media);
  } catch (err) {
    const message = err instanceof Error ? err.message : "AI analysis failed";
    const timedOut = message.includes("exceeded");
    return NextResponse.json(
      { error: timedOut ? "AI analysis timed out — please try again." : "AI analysis failed — please try again." },
      { status: timedOut ? 504 : 502 }
    );
  }

  // Persist just the first frame/photo as the visual record shown back to
  // the responder — same flat data/uploads/ convention as admin-uploaded
  // option images (crypto.randomUUID() + ext, no path components accepted
  // anywhere else in the app).
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
  const ext = files[0].type === "image/png" ? ".png" : files[0].type === "image/webp" ? ".webp" : ".jpg";
  const filename = `${crypto.randomUUID()}${ext}`;
  fs.writeFileSync(path.join(uploadsDir, filename), buffers[0]);

  return NextResponse.json({ ...result, mediaUrl: `/uploads/${filename}` });
}
