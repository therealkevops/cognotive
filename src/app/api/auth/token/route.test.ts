// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE, seal, unseal, type Session } from "@/lib/server/session";
import { GET } from "./route";

const SECRET = "s".repeat(32);

function request(cookie?: string) {
  return new NextRequest("https://notes.example/api/auth/token", {
    headers: cookie ? { cookie: `${SESSION_COOKIE}=${cookie}` } : {},
  });
}

function session(overrides: Partial<Session> = {}): Session {
  const now = Date.now();
  return {
    uid: 1,
    login: "kev",
    at: "ghu_old",
    atExp: now + 3600_000,
    rt: "ghr_old",
    rtExp: now + 86400_000,
    ...overrides,
  };
}

beforeEach(() => {
  vi.stubEnv("GITHUB_APP_CLIENT_ID", "Iv1.abc");
  vi.stubEnv("GITHUB_APP_CLIENT_SECRET", "secret");
  vi.stubEnv("SESSION_SECRET", SECRET);
  vi.stubEnv("GITHUB_APP_SLUG", "noted-ai-kev");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("GET /api/auth/token", () => {
  it("says so when sign-in isn't configured", async () => {
    vi.stubEnv("SESSION_SECRET", "");
    const res = await GET(request());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ configured: false });
  });

  it("returns 401 without a session", async () => {
    expect((await GET(request())).status).toBe(401);
  });

  it("returns the cached access token while it is fresh", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const res = await GET(request(await seal(session(), SECRET)));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      token: "ghu_old",
      user: { id: 1, login: "kev" },
      installUrl: "/api/auth/install",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("refreshes a nearly expired token and stores the rotated refresh token", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ access_token: "ghu_new", expires_in: 28800, refresh_token: "ghr_new" })),
    );
    const res = await GET(request(await seal(session({ atExp: Date.now() + 1000 }), SECRET)));
    expect((await res.json()).token).toBe("ghu_new");
    const cookie = res.cookies.get(SESSION_COOKIE)?.value;
    const stored = await unseal<Session>(cookie, SECRET);
    expect(stored).toMatchObject({ at: "ghu_new", rt: "ghr_new", login: "kev" });
  });

  it("signs out when the refresh fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "bad_refresh_token" })));
    const res = await GET(request(await seal(session({ atExp: 0 }), SECRET)));
    expect(res.status).toBe(401);
    expect(res.cookies.get(SESSION_COOKIE)?.value).toBe("");
  });
});
