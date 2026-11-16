// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const req = (body: unknown) =>
  new NextRequest("https://notes.example/api/setup/vercel", { method: "POST", body: JSON.stringify(body) });

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("POST /api/setup/vercel", () => {
  it("does nothing once GitHub is set up", async () => {
    vi.stubEnv("GITHUB_APP_CLIENT_ID", "Iv1.abc");
    vi.stubEnv("GITHUB_APP_CLIENT_SECRET", "x");
    vi.stubEnv("SESSION_SECRET", "s".repeat(32));
    vi.stubEnv("VERCEL_PROJECT_ID", "prj_1");
    vi.stubEnv("VERCEL_DEPLOYMENT_ID", "dpl_1");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const res = await POST(req({ token: "tok", vars: [["GITHUB_APP_SLUG", "x"]] }));
    expect(res.status).toBe(409);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("explains when it isn't running on Vercel", async () => {
    vi.stubEnv("GITHUB_APP_CLIENT_ID", "");
    vi.stubEnv("VERCEL_PROJECT_ID", "");
    const res = await POST(req({ token: "tok", vars: [] }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/isn't running on Vercel/);
  });

  it("asks for a token", async () => {
    vi.stubEnv("GITHUB_APP_CLIENT_ID", "");
    vi.stubEnv("VERCEL_PROJECT_ID", "prj_1");
    vi.stubEnv("VERCEL_DEPLOYMENT_ID", "dpl_1");
    const res = await POST(req({ vars: [] }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/token/);
  });
});
