import crypto from "crypto";
import { cookies } from "next/headers";
import { createAdminSession, isValidAdminSession, deleteAdminSession } from "./db";

export const ADMIN_COOKIE_NAME = "aed_admin";
export const ADMIN_SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8h, matches the cookie's maxAge

function secret() {
  // No fallback: an unset ADMIN_PASSWORD must deny every login attempt, not
  // silently accept a guessable default. checkPassword() returning false
  // for every input (rather than the route throwing) is what "fails closed"
  // means here — a misconfigured deploy just can't log in, it doesn't fall
  // back to something an attacker could know in advance.
  return process.env.ADMIN_PASSWORD || null;
}

export function checkPassword(password) {
  const s = secret();
  if (!s || typeof password !== "string" || password.length === 0) return false;
  const given = Buffer.from(password);
  const expected = Buffer.from(s);
  // timingSafeEqual requires equal-length buffers; a length mismatch is
  // itself a safe, cheap "no" (it leaks only length, not content).
  if (given.length !== expected.length) return false;
  return crypto.timingSafeEqual(given, expected);
}

// Called after checkPassword() succeeds — issues a random per-login token
// (unrelated to the password) and records only its hash server-side, so
// logout can revoke it and a DB read alone can't reconstruct a valid cookie.
export function issueAdminSession() {
  const token = crypto.randomBytes(32).toString("hex");
  createAdminSession(token, ADMIN_SESSION_TTL_MS);
  return token;
}

export function revokeAdminSession(token) {
  if (token) deleteAdminSession(token);
}

export async function isAdminAuthed() {
  const store = await cookies();
  const token = store.get(ADMIN_COOKIE_NAME)?.value;
  return isValidAdminSession(token);
}
