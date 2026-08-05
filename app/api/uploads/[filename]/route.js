import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const uploadsDir = path.join(process.cwd(), "data", "uploads");

// Kept in lockstep with ALLOWED_EXT in app/api/admin/upload/route.js — .svg
// is deliberately absent from both (an SVG can carry a <script> that a
// browser will execute if its URL is ever opened as a top-level navigation).
const CONTENT_TYPES = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

// Admin-uploaded option images live on the persisted volume (see next.config.mjs
// for the /uploads/* rewrite that routes here) rather than in /public, so a
// single Railway volume can cover both this and the SQLite database. Filenames
// are always the crypto.randomUUID() + extension generated at upload time in
// app/api/admin/upload/route.js — reject anything else to rule out path traversal.
export async function GET(request, { params }) {
  const { filename } = await params;
  if (!/^[a-f0-9-]+\.[a-z0-9]+$/i.test(filename)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const ext = path.extname(filename).toLowerCase();
  const contentType = CONTENT_TYPES[ext];
  if (!contentType) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const filePath = path.join(uploadsDir, filename);
  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const buffer = fs.readFileSync(filePath);
  return new NextResponse(buffer, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
