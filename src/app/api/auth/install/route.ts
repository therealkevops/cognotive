import { NextResponse, type NextRequest } from "next/server";
import { authConfig } from "@/lib/server/github-oauth";
import { STATE_COOKIE, cookieOptions } from "@/lib/server/session";

/**
 * Installs the GitHub App on repositories and signs in, in one trip: the app
 * asks for authorization on install, so GitHub comes back to the callback with
 * a sign-in code. The state check works as it does for a plain sign-in.
 */
export function GET(request: NextRequest) {
  const config = authConfig();
  if (!config) return NextResponse.redirect(new URL("/?auth_error=not_configured", request.url));
  if (!config.appSlug) return NextResponse.redirect(new URL("/api/auth/login", request.url));

  const state = crypto.randomUUID();
  const url = new URL(`https://github.com/apps/${encodeURIComponent(config.appSlug)}/installations/new`);
  url.searchParams.set("state", state);
  const res = NextResponse.redirect(url);
  res.cookies.set(STATE_COOKIE, state, cookieOptions(600));
  return res;
}
