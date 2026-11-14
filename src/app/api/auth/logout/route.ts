import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/server/session";

/** Signs out by dropping the session cookie. The GitHub authorization itself stays. */
export function POST() {
  const res = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  res.cookies.delete({ name: SESSION_COOKIE, path: "/api/auth" });
  return res;
}
