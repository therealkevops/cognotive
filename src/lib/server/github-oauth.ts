import type { Session } from "./session";

/** Server configuration, from environment variables. See .env.example. */
export interface AuthConfig {
  clientId: string;
  clientSecret: string;
  sessionSecret: string;
  appSlug: string | undefined;
  /** GitHub user ids allowed to sign in; empty means anyone. */
  allowedUserIds: number[];
}

export function authConfig(env: Record<string, string | undefined> = process.env): AuthConfig | null {
  const clientId = env.GITHUB_APP_CLIENT_ID;
  const clientSecret = env.GITHUB_APP_CLIENT_SECRET;
  const sessionSecret = env.SESSION_SECRET;
  if (!clientId || !clientSecret || !sessionSecret) return null;
  return {
    clientId,
    clientSecret,
    sessionSecret,
    appSlug: env.GITHUB_APP_SLUG || undefined,
    allowedUserIds: (env.ALLOWED_GITHUB_USER_IDS ?? "")
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isInteger(n) && n > 0),
  };
}

export function isAllowed(config: AuthConfig, userId: number): boolean {
  return config.allowedUserIds.length === 0 || config.allowedUserIds.includes(userId);
}

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
  error?: string;
  error_description?: string;
}

export class OAuthError extends Error {}

const TOKEN_URL = "https://github.com/login/oauth/access_token";

async function tokenRequest(params: Record<string, string>, fetchFn: typeof fetch): Promise<TokenResponse> {
  const res = await fetchFn(TOKEN_URL, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
    cache: "no-store",
  });
  if (!res.ok) throw new OAuthError(`GitHub token endpoint returned ${res.status}`);
  const body = (await res.json()) as TokenResponse;
  // GitHub reports OAuth errors with a 200 status and an "error" field.
  if (body.error || !body.access_token) {
    throw new OAuthError(body.error_description ?? body.error ?? "No access token in response");
  }
  return body;
}

function toTokens(t: TokenResponse, now: number): Pick<Session, "at" | "atExp" | "rt" | "rtExp"> {
  if (!t.refresh_token) {
    throw new OAuthError(
      "GitHub returned no refresh token. Turn on 'Expire user authorization tokens' in the GitHub App settings.",
    );
  }
  return {
    at: t.access_token!,
    atExp: now + (t.expires_in ?? 8 * 3600) * 1000,
    rt: t.refresh_token,
    rtExp: now + (t.refresh_token_expires_in ?? 180 * 86400) * 1000,
  };
}

export async function exchangeCode(
  config: AuthConfig,
  code: string,
  redirectUri: string,
  fetchFn: typeof fetch = fetch,
  now = Date.now(),
) {
  const t = await tokenRequest(
    { client_id: config.clientId, client_secret: config.clientSecret, code, redirect_uri: redirectUri },
    fetchFn,
  );
  return toTokens(t, now);
}

export async function refreshTokens(
  config: AuthConfig,
  refreshToken: string,
  fetchFn: typeof fetch = fetch,
  now = Date.now(),
) {
  const t = await tokenRequest(
    {
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    },
    fetchFn,
  );
  return toTokens(t, now);
}

export async function fetchUser(accessToken: string, fetchFn: typeof fetch = fetch) {
  const res = await fetchFn("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "noted-ai",
    },
    cache: "no-store",
  });
  if (!res.ok) throw new OAuthError(`Couldn't read the GitHub user (${res.status})`);
  const user = (await res.json()) as { id: number; login: string };
  return { id: user.id, login: user.login };
}

/** Refresh the access token when it has less than this left. */
export const REFRESH_MARGIN_MS = 10 * 60 * 1000;
