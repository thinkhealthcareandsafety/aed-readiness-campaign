import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { revokeAdminSession, ADMIN_COOKIE_NAME } from "@/lib/adminAuth";

export async function POST() {
  const store = await cookies();
  const token = store.get(ADMIN_COOKIE_NAME)?.value;
  revokeAdminSession(token);

  const res = NextResponse.json({ ok: true });
  res.cookies.delete(ADMIN_COOKIE_NAME);
  return res;
}
