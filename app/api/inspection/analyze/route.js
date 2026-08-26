import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { getChecklistItem } from "@/lib/inspectionChecklist";
import { analyzeChecklistItem } from "@/lib/inspectionGemini";
import { checkRateLimit } from "@/lib/rateLimiter";

// Same persisted-volume convention as app/api/admin/upload/route.js — see
// app/api/uploads/[filename]/route.js for how these are served back out.
const uploadsDir = path.join(process.cwd(), "data", "uploads");

const MAX_FILE_BYTES = 6 * 1024 * 1024; // one photo, or one extracted video frame
const MAX_FILES = 26; // the readiness-indicator's frame count now scales with clip length, up to 24, plus headroom
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function POST(request) {
  // A burst of concurrent auto-scans is the expected happy path (this
  // link goes out to many hotel staff at once) — this only bounds how much
  // load one single caller can put on the Gemini call budget per minute,
  // it isn't meant to (and won't) throttle legitimate multi-client traffic.
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!checkRateLimit(ip)) {
    return NextResponse.json({ error: "Too many scans right now — please wait a moment and try again." }, { status: 429 });
  }

  const formData = await request.formData().catch(() => null);
  if (!formData) return NextResponse.json({ error: "Invalid form data" }, { status: 400 });

  const itemId = formData.get("itemId");
  if (typeof itemId !== "string" || !getChecklistItem(itemId)) {
    return NextResponse.json({ error: "Unknown checklist item" }, { status: 400 });
  }
  // Which physical unit's own selected AED model to use for prompt
  // guidance — optional (falls back to generic guidance in
  // lib/inspectionChecklist.js) so an older/direct client without this
  // field still works, just without brand-specific accuracy.
  const aedModelRaw = formData.get("aedModel");
  const aedModel = typeof aedModelRaw === "string" && aedModelRaw ? aedModelRaw : null;

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
    result = await analyzeChecklistItem(itemId, media, aedModel);
  } catch (err) {
    const message = err instanceof Error ? err.message : "AI analysis failed";
    const timedOut = message.includes("exceeded");
    return NextResponse.json(
      { error: timedOut ? "AI analysis timed out — please try again." : "AI analysis failed — please try again." },
      { status: timedOut ? 504 : 502 }
    );
  }

  // Persist whichever frame Gemini itself pointed to as the evidence for
  // its verdict (key_frame_index, only meaningful for the multi-frame video
  // item) — falls back to the first frame for a single-photo item, or if
  // the model left it out/returned something out of range. Previously this
  // always saved frame 1, which for a video call could show a dark,
  // inconclusive moment even when the actual pass/fail was correctly based
  // on a flash caught later in the clip — a real mismatch between the
  // audit's saved visual record and the evidence behind its own verdict.
  const { key_frame_index, ...publicResult } = result;
  const frameIndex =
    Number.isInteger(key_frame_index) && key_frame_index >= 1 && key_frame_index <= buffers.length
      ? key_frame_index - 1
      : 0;

  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
  const persistedFile = files[frameIndex];
  const ext = persistedFile.type === "image/png" ? ".png" : persistedFile.type === "image/webp" ? ".webp" : ".jpg";
  const filename = `${crypto.randomUUID()}${ext}`;
  fs.writeFileSync(path.join(uploadsDir, filename), buffers[frameIndex]);

  return NextResponse.json({ ...publicResult, mediaUrl: `/uploads/${filename}` });
}
