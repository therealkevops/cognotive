// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { authConfig, exchangeCode, isAllowed, refreshTokens } from "./github-oauth";

const env = {
  GITHUB_APP_CLIENT_ID: "Iv1.abc",
  GITHUB_APP_CLIENT_SECRET: "secret",
  SESSION_SECRET: "s".repeat(32),
  ALLOWED_GITHUB_USER_IDS: "19527226, 42",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("authConfig", () => {
  it("is null until the three required variables are set", () => {
    expect(authConfig({})).toBeNull();
    expect(authConfig({ ...env, SESSION_SECRET: "" })).toBeNull();
  });

  it("parses the allowlist", () => {
    const c = authConfig(env)!;
    expect(c.allowedUserIds).toEqual([19527226, 42]);
    expect(isAllowed(c, 42)).toBe(true);
    expect(isAllowed(c, 7)).toBe(false);
    expect(isAllowed(authConfig({ ...env, ALLOWED_GITHUB_USER_IDS: "" })!, 7)).toBe(true);
  });
});

describe("token requests", () => {
  const config = authConfig(env)!;

  it("exchanges a code and computes expiries", async () => {
    const fetchFn = vi.fn(async () =>
      json({ access_token: "ghu_a", expires_in: 28800, refresh_token: "ghr_r", refresh_token_expires_in: 100 }),
    );
    const t = await exchangeCode(config, "code1", "https://app/cb", fetchFn as typeof fetch, 1000);
    expect(t).toEqual({ at: "ghu_a", atExp: 1000 + 28800_000, rt: "ghr_r", rtExp: 1000 + 100_000 });
    const body = (fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1].body as URLSearchParams;
    expect(body.get("code")).toBe("code1");
    expect(body.get("redirect_uri")).toBe("https://app/cb");
  });

  it("refreshes with the refresh token", async () => {
    const fetchFn = vi.fn(async () => json({ access_token: "ghu_b", refresh_token: "ghr_s" }));
    const t = await refreshTokens(config, "ghr_r", fetchFn as typeof fetch);
    expect(t.at).toBe("ghu_b");
    const body = (fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1].body as URLSearchParams;
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("ghr_r");
  });

  it("surfaces GitHub's 200-with-error responses", async () => {
    const fetchFn = async () => json({ error: "bad_verification_code", error_description: "The code is wrong" });
    await expect(exchangeCode(config, "x", "y", fetchFn as typeof fetch)).rejects.toThrow("The code is wrong");
  });

  it("explains a missing refresh token", async () => {
    const fetchFn = async () => json({ access_token: "ghu_a" });
    await expect(exchangeCode(config, "x", "y", fetchFn as typeof fetch)).rejects.toThrow(/Expire user authorization/);
  });
});
