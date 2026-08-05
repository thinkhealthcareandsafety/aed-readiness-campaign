import { NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/adminAuth";
import fs from "fs";
import path from "path";
import crypto from "crypto";

// Lives on the same persisted volume as the database (see next.config.mjs and
// app/api/uploads/[filename]/route.js for how these are served back out at
// the same /uploads/<file> URL, despite not being under /public anymore).
const uploadsDir = path.join(process.cwd(), "data", "uploads");

// .svg deliberately excluded: browsers execute inline <script>/event-handler
// content in an SVG opened as a top-level document, so an uploaded SVG could
// carry stored XSS if its /uploads/<file> URL is ever navigated to directly
// — unlike the raster formats here, which can't execute script.
const ALLOWED_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // 8MB — generous for a reference photo, not for filling a disk

export async function POST(request) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");
  if (!file || typeof file === "string") {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "File too large (max 8MB)" }, { status: 400 });
  }

  const originalName = file.name || "upload";
  const ext = path.extname(originalName).toLowerCase() || ".jpg";
  if (!ALLOWED_EXT.has(ext)) {
    return NextResponse.json({ error: "Unsupported file type" }, { status: 400 });
  }

  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

  const filename = `${crypto.randomUUID()}${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  fs.writeFileSync(path.join(uploadsDir, filename), buffer);

  return NextResponse.json({ url: `/uploads/${filename}` }, { status: 201 });
}
