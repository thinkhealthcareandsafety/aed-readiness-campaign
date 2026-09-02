import fs from "fs";
import path from "path";

// Everything the app writes at runtime — the SQLite database and
// admin-uploaded images — lives under one directory, so a host only has to
// provide (and persist) a single mounted volume.
//
// Defaults to ./data next to the source, which is what running locally
// expects. AED_DATA_DIR overrides it so a platform can mount its disk
// somewhere outside the deployed source tree (Render mounts at /var/data,
// for instance) without the checkout and the volume fighting over the same
// path. AED_DB_PATH still wins for the database file specifically, so an
// existing deployment setting only that keeps working unchanged.
export const DATA_DIR = process.env.AED_DATA_DIR || path.join(process.cwd(), "data");

export const UPLOADS_DIR = path.join(DATA_DIR, "uploads");

export function ensureUploadsDir() {
  if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  return UPLOADS_DIR;
}
