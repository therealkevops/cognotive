// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { STATE_COOKIE } from "@/lib/server/session";
import { GET as callback } from "../callback/route";
import { GET } from "./route";

afterEach(() => vi.unstubAllEnvs());

function configure() {
  vi.stubEnv("GITHUB_APP_CLIENT_ID", "Iv1.abc");
  vi.stubEnv("GITHUB_APP_CLIENT_SECRET", "secret");
  vi.stubEnv("SESSION_SECRET", "s".repeat(32));
  vi.stubEnv("GITHUB_APP_SLUG", "noted-ai-kev");
}

describe("GET /api/auth/install", () => {
  it("sends the user to install the app, with a state the callback will check", async () => {
    configure();
    const res = GET(new NextRequest("https://notes.example/api/auth/install"));
    const location = new URL(res.headers.get("location")!);
    expect(location.origin + location.pathname).toBe("https://github.com/apps/noted-ai-kev/installations/new");
    const state = location.searchParams.get("state");
    expect(state).toBeTruthy();
    expect(res.cookies.get(STATE_COOKIE)?.value).toBe(state);
  });

  it("goes home with a message when GitHub isn't set up", () => {
    vi.stubEnv("GITHUB_APP_CLIENT_ID", "");
    const res = GET(new NextRequest("https://notes.example/api/auth/install"));
    expect(res.headers.get("location")).toBe("https://notes.example/?auth_error=not_configured");
  });
});

describe("callback after an install it didn't start", () => {
  it("starts a normal sign-in instead of failing", async () => {
    configure();
    const res = await callback(
      new NextRequest("https://notes.example/api/auth/callback?code=abc&installation_id=1&setup_action=install"),
    );
    expect(res.headers.get("location")).toBe("https://notes.example/api/auth/login");
  });

  it("still rejects a sign-in with a bad state", async () => {
    configure();
    const res = await callback(new NextRequest("https://notes.example/api/auth/callback?code=abc&state=forged"));
    expect(res.headers.get("location")).toBe("https://notes.example/?auth_error=bad_state");
  });
});
