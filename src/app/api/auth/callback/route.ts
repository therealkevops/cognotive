import { NextResponse, type NextRequest } from "next/server";
import { authConfig, exchangeCode, fetchUser, isAllowed } from "@/lib/server/github-oauth";
import { SESSION_COOKIE, STATE_COOKIE, cookieOptions, seal, type Session } from "@/lib/server/session";

/** GitHub redirects here after sign-in (and after installing the app, if "request authorization" is on). */
export async function GET(request: NextRequest) {
  const home = (error?: string) => {
    const url = new URL("/", request.url);
    if (error) url.searchParams.set("auth_error", error);
    const res = NextResponse.redirect(url);
    res.cookies.delete({ name: STATE_COOKIE, path: "/api/auth" });
    return res;
  };

  const config = authConfig();
  if (!config) return home("not_configured");

  const params = request.nextUrl.searchParams;
  const code = params.get("code");
  const state = params.get("state");
  const expected = request.cookies.get(STATE_COOKIE)?.value;
  if (params.get("error")) return home("denied");
  // Back from installing (or changing) the app without a sign-in we started, e.g. from
  // "Choose repositories": start a normal sign-in, which GitHub completes without asking.
  if (params.get("setup_action") && (!state || !expected || state !== expected)) {
    return NextResponse.redirect(new URL("/api/auth/login", request.url));
  }
  if (!code || !state || !expected || state !== expected) return home("bad_state");

  try {
    const redirectUri = new URL("/api/auth/callback", request.url).toString();
    const tokens = await exchangeCode(config, code, redirectUri);
    const user = await fetchUser(tokens.at);
    if (!isAllowed(config, user.id)) return home("not_allowed");

    const session: Session = { uid: user.id, login: user.login, ...tokens };
    const res = home();
    res.cookies.set(
      SESSION_COOKIE,
      await seal(session, config.sessionSecret),
      cookieOptions(Math.floor((session.rtExp - Date.now()) / 1000)),
    );
    return res;
  } catch (e) {
    console.error("GitHub sign-in failed:", e instanceof Error ? e.message : e);
    return home("failed");
  }
}
