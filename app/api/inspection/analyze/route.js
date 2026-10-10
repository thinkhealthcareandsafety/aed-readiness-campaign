import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { getChecklistItem } from "@/lib/inspectionChecklist";
import { analyzeChecklistItem, DailyLimitReached } from "@/lib/inspectionGemini";
import { checkRateLimit } from "@/lib/rateLimiter";

// Same persisted-volume convention as app/api/admin/upload/route.js — see
// app/api/uploads/[filename]/route.js for how these are served back out.
import { UPLOADS_DIR, ensureUploadsDir } from "@/lib/dataDir";

const MAX_FILE_BYTES = 6 * 1024 * 1024; // one photo, or one extracted video frame
const MAX_FILES = 26; // a readiness clip sends up to 24 frames (lib/readinessScan.js), plus headroom
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

// What the browser's scan of every frame of a readiness clip found (see
// lib/readinessScan.js). It decides whether a blinking unit can pass, so a
// malformed one is dropped — the clip is then judged as unscanned, which can
// only make a pass harder, never easier.
function parseScan(raw, frameCount) {
  if (typeof raw !== "string" || !raw) return null;
  let scan;
  try {
    scan = JSON.parse(raw);
  } catch {
    return null;
  }
  const finite = (v, lo, hi) => typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;
  const { times, flashPositions, flashCount, duration, steadyShare } = scan || {};
  if (!Array.isArray(times) || times.length !== frameCount || !times.every((t) => finite(t, 0, 600))) return null;
  if (!Array.isArray(flashPositions) || !flashPositions.every((p) => Number.isInteger(p) && p >= 1 && p <= frameCount)) return null;
  if (!Number.isInteger(flashCount) || flashCount < 0 || flashCount > 200) return null;
  if (!finite(duration, 0, 600) || !finite(steadyShare, 0, 1)) return null;
  return { times, flashPositions, flashCount, duration, steadyShare };
}

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

  const isVideoItem = getChecklistItem(itemId).mediaType === "video";
  const scan = isVideoItem ? parseScan(formData.get("scan"), files.length) : null;
  const guided = isVideoItem && formData.get("guided") === "1";

  let result;
  try {
    result = await analyzeChecklistItem(itemId, media, aedModel, { scan, guided });
  } catch (err) {
    if (err instanceof DailyLimitReached) {
      return NextResponse.json(
        { error: "AI scanning is paused for today — please answer these questions manually." },
        { status: 503 }
      );
    }
    const message = err instanceof Error ? err.message : "AI analysis failed";
    const timedOut = message.includes("exceeded");
    return NextResponse.json(
      { error: timedOut ? "AI analysis timed out — please try again." : "AI analysis failed — please try again." },
      { status: timedOut ? 504 : 502 }
    );
  }

  // Persist the frame that is the evidence for the verdict (key_frame_index,
  // only meaningful for the multi-frame video item: the first frame the
  // model cited as showing the ready signal, else the one it picked) — falls
  // back to the first frame for a single-photo item, or if the index is
  // missing or out of range. Always saving frame 1 could show a dark,
  // inconclusive moment even when the verdict was correctly based on a flash
  // caught later in the clip.
  const { key_frame_index, ...publicResult } = result;
  const frameIndex =
    Number.isInteger(key_frame_index) && key_frame_index >= 1 && key_frame_index <= buffers.length
      ? key_frame_index - 1
      : 0;

  ensureUploadsDir();
  const persistedFile = files[frameIndex];
  const ext = persistedFile.type === "image/png" ? ".png" : persistedFile.type === "image/webp" ? ".webp" : ".jpg";
  const filename = `${crypto.randomUUID()}${ext}`;
  fs.writeFileSync(path.join(UPLOADS_DIR, filename), buffers[frameIndex]);

  return NextResponse.json({ ...publicResult, mediaUrl: `/uploads/${filename}` });
}
