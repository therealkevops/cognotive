import { describe, expect, it } from "vitest";
import { buildCommit, deploymentEnv } from "./app-info";

describe("buildCommit", () => {
  it("shortens the Vercel commit SHA to seven characters", () => {
    expect(buildCommit({ VERCEL_GIT_COMMIT_SHA: "a531e0f9c2b4d6e8" })).toBe("a531e0f");
  });

  it('reports "local" when not built on Vercel', () => {
    expect(buildCommit({})).toBe("local");
  });
});

describe("deploymentEnv", () => {
  it("uses VERCEL_ENV when set", () => {
    expect(deploymentEnv({ VERCEL_ENV: "preview" })).toBe("preview");
  });

  it("defaults to development", () => {
    expect(deploymentEnv({})).toBe("development");
  });
});
