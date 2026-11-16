import { NextResponse, type NextRequest } from "next/server";
import { REFRESH_MARGIN_MS, authConfig, refreshTokens } from "@/lib/server/github-oauth";
import { SESSION_COOKIE, cookieOptions, seal, unseal, type Session } from "@/lib/server/session";

export interface TokenResponse {
  token: string;
  expiresAt: number;
  user: { id: number; login: string };
  /** Where to install the GitHub App on more repositories (and sign in), if GITHUB_APP_SLUG is set. */
  installUrl: string | null;
}

const noStore = { "Cache-Control": "no-store" };

/**
 * Gives the browser a GitHub access token for direct API calls. The refresh
 * token never leaves the encrypted cookie. A still-valid access token is reused,
 * so several tabs don't race to rotate the refresh token.
 */
export async function GET(request: NextRequest) {
  const config = authConfig();
  // 200, not an error status: an unconfigured deployment is a normal state (local vaults only).
  if (!config) return NextResponse.json({ configured: false }, { headers: noStore });

  let session = await unseal<Session>(request.cookies.get(SESSION_COOKIE)?.value, config.sessionSecret);
  const signedOut = () => {
    const res = NextResponse.json({ error: "signed_out" }, { status: 401, headers: noStore });
    res.cookies.delete({ name: SESSION_COOKIE, path: "/api/auth" });
    return res;
  };
  if (!session || session.rtExp < Date.now()) return signedOut();

  let refreshed = false;
  if (session.atExp - Date.now() < REFRESH_MARGIN_MS) {
    try {
      session = { ...session, ...(await refreshTokens(config, session.rt)) };
      refreshed = true;
    } catch (e) {
      console.error("Token refresh failed:", e instanceof Error ? e.message : e);
      return signedOut();
    }
  }

  const body: TokenResponse = {
    token: session.at,
    expiresAt: session.atExp,
    user: { id: session.uid, login: session.login },
    installUrl: config.appSlug ? "/api/auth/install" : null,
  };
  const res = NextResponse.json(body, { headers: noStore });
  if (refreshed) {
    res.cookies.set(
      SESSION_COOKIE,
      await seal(session, config.sessionSecret),
      cookieOptions(Math.floor((session.rtExp - Date.now()) / 1000)),
    );
  }
  return res;
}
