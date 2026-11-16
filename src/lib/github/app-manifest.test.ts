import { describe, expect, it, vi } from "vitest";
import { appManifest, convertManifestCode, defaultAppName, envVars, randomSessionSecret } from "./app-manifest";

describe("appManifest", () => {
  it("asks for contents access only, with sign-in on install and no webhook", () => {
    const m = appManifest("https://notes.example.com/", " noted-ai-kev ");
    expect(m.name).toBe("noted-ai-kev");
    expect(m.redirect_url).toBe("https://notes.example.com/github-setup");
    expect(m.callback_urls).toEqual(["https://notes.example.com/api/auth/callback"]);
    expect(m.default_permissions).toEqual({ contents: "write" });
    expect(m.hook_attributes.active).toBe(false);
    expect(m.request_oauth_on_install).toBe(true);
    expect(m.public).toBe(false);
  });
});

describe("defaultAppName", () => {
  it("adds a four-character suffix", () => {
    expect(defaultAppName(() => 0)).toBe("noted-ai-0000");
    expect(defaultAppName(() => 0.5)).toMatch(/^noted-ai-[0-9a-z]{4}$/);
  });
});

describe("convertManifestCode", () => {
  it("returns the new app's credentials", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({
        slug: "noted-ai-kev",
        name: "noted-ai-kev",
        html_url: "https://github.com/apps/noted-ai-kev",
        client_id: "Iv1.abc",
        client_secret: "shh",
        owner: { id: 42, login: "kev" },
      }),
    );
    const app = await convertManifestCode("abc123", fetcher as unknown as typeof fetch);
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.github.com/app-manifests/abc123/conversions",
      expect.objectContaining({ method: "POST" }),
    );
    expect(app).toMatchObject({ slug: "noted-ai-kev", clientId: "Iv1.abc", clientSecret: "shh", owner: { id: 42 } });
    expect(envVars(app, "s3cret")).toEqual([
      ["GITHUB_APP_CLIENT_ID", "Iv1.abc"],
      ["GITHUB_APP_CLIENT_SECRET", "shh"],
      ["GITHUB_APP_SLUG", "noted-ai-kev"],
      ["SESSION_SECRET", "s3cret"],
      ["ALLOWED_GITHUB_USER_IDS", "42"],
    ]);
  });

  it("explains an expired or used code", async () => {
    const fetcher = async () => new Response("", { status: 404 });
    await expect(convertManifestCode("abc", fetcher as typeof fetch)).rejects.toThrow(/works once/);
  });

  it("rejects a code that isn't a code", async () => {
    await expect(convertManifestCode("../x", fetch)).rejects.toThrow(/isn't valid/);
  });
});

describe("randomSessionSecret", () => {
  it("is 32 random bytes in base64", () => {
    const s = randomSessionSecret();
    expect(atob(s)).toHaveLength(32);
    expect(randomSessionSecret()).not.toBe(s);
  });
});
