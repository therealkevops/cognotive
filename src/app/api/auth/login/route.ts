import { NextResponse, type NextRequest } from "next/server";
import { authConfig } from "@/lib/server/github-oauth";
import { STATE_COOKIE, cookieOptions } from "@/lib/server/session";

/** Starts GitHub sign-in: redirects to GitHub's authorize page with a CSRF state. */
export function GET(request: NextRequest) {
  const config = authConfig();
  if (!config) return NextResponse.redirect(new URL("/?auth_error=not_configured", request.url));

  const state = crypto.randomUUID();
  const redirectUri = new URL("/api/auth/callback", request.url).toString();
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);

  const res = NextResponse.redirect(url);
  res.cookies.set(STATE_COOKIE, state, cookieOptions(600));
  return res;
}
