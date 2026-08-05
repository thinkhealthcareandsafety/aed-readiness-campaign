import { NextResponse } from "next/server";
import { checkPassword, issueAdminSession, ADMIN_COOKIE_NAME, ADMIN_SESSION_TTL_MS } from "@/lib/adminAuth";

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  if (!checkPassword(body.password)) {
    return NextResponse.json({ error: "Incorrect password" }, { status: 401 });
  }

  const token = issueAdminSession();
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ADMIN_SESSION_TTL_MS / 1000,
  });
  return res;
}
