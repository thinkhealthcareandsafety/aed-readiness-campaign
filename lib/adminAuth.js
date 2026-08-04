import crypto from "crypto";
import { cookies } from "next/headers";

export const ADMIN_COOKIE_NAME = "aed_admin";

function secret() {
  return process.env.ADMIN_PASSWORD || "changeme";
}

export function checkPassword(password) {
  return typeof password === "string" && password.length > 0 && password === secret();
}

export function adminCookieValue() {
  return crypto.createHash("sha256").update(secret()).digest("hex");
}

export async function isAdminAuthed() {
  const store = await cookies();
  const value = store.get(ADMIN_COOKIE_NAME)?.value;
  return value === adminCookieValue();
}
