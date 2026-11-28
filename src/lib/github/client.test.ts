import { describe, expect, it, vi } from "vitest";
import { base64ToUtf8, GitHubClient, GitHubError, utf8ToBase64 } from "./client";

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

function client(responses: Response[]) {
  const fetchFn = vi.fn(async () => responses.shift()!);
  return { gh: new GitHubClient(async () => "ghu_tok", fetchFn as unknown as typeof fetch), fetchFn };
}

describe("base64 helpers", () => {
  it("round-trip unicode", () => {
    const text = "Café ☕ — naïve 日本語\n";
    expect(base64ToUtf8(utf8ToBase64(text))).toBe(text);
  });
});

describe("GitHubClient", () => {
  it("sends the token and API version", async () => {
    const { gh, fetchFn } = client([json({ object: { sha: "abc" } })]);
    expect(await gh.branchHead("o", "r", "main")).toBe("abc");
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.github.com/repos/o/r/git/ref/heads/main");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer ghu_tok");
  });

  it("reports a missing branch or empty repo as null", async () => {
    const { gh } = client([json({ message: "Not Found" }, 404), json({ message: "Git Repository is empty." }, 409)]);
    expect(await gh.branchHead("o", "r", "main")).toBeNull();
    expect(await gh.branchHead("o", "r", "main")).toBeNull();
  });

  it("decodes base64 blobs", async () => {
    const { gh } = client([json({ content: utf8ToBase64("# Hé\n"), encoding: "base64" })]);
    expect(await gh.blob("o", "r", "sha")).toBe("# Hé\n");
  });

  it("refuses truncated trees", async () => {
    const { gh } = client([json({ tree: [], truncated: true })]);
    await expect(gh.tree("o", "r", "t")).rejects.toThrow(/too large/);
  });

  it("explains rate limiting", async () => {
    const { gh } = client([json({ message: "API rate limit exceeded" }, 403, { "x-ratelimit-remaining": "0" })]);
    await expect(gh.blob("o", "r", "s")).rejects.toThrow(/rate limit/);
  });

  it("lists a token's repos, following pages", async () => {
    const repo = (i: number) => ({
      name: `r${i}`,
      full_name: `o/r${i}`,
      owner: { login: "o" },
      default_branch: "main",
      private: true,
    });
    const page1 = Array.from({ length: 100 }, (_, i) => repo(i));
    const { gh } = client([json(page1), json([repo(100)])]);
    const repos = await gh.listUserRepos();
    expect(repos).toHaveLength(101);
    expect(repos[0]).toEqual({ owner: "o", name: "r0", fullName: "o/r0", defaultBranch: "main", private: true });
  });

  it("raises GitHubError with the API's message", async () => {
    const { gh } = client([json({ message: "Update is not a fast forward" }, 422)]);
    const err = await gh.updateBranch("o", "r", "main", "sha").catch((e) => e);
    expect(err).toBeInstanceOf(GitHubError);
    expect(err).toMatchObject({ status: 422, message: "Update is not a fast forward" });
  });
});

describe("personal access tokens", () => {
  it("parses GitHub's expiry header", async () => {
    const { parseTokenExpiry } = await import("./client");
    expect(parseTokenExpiry("2026-12-01 00:00:00 UTC")).toBe(Date.parse("2026-12-01T00:00:00Z"));
    expect(parseTokenExpiry("2026-12-01 12:00:00 -0700")).toBe(Date.parse("2026-12-01T19:00:00Z"));
    expect(parseTokenExpiry(null)).toBeNull();
    expect(parseTokenExpiry("soon")).toBeNull();
  });

  it("checks a token and reads its expiry", async () => {
    const fetchFn = vi.fn(async () =>
      Response.json(
        { login: "kev", id: 7 },
        { headers: { "github-authentication-token-expiration": "2027-01-01 00:00:00 UTC" } },
      ),
    );
    const client = new GitHubClient(async () => "github_pat_x", fetchFn as unknown as typeof fetch);
    expect(await client.checkToken()).toEqual({ login: "kev", id: 7, expiresAt: Date.parse("2027-01-01T00:00:00Z") });
  });

  it("explains a rejected token", async () => {
    const client = new GitHubClient(async () => "bad", (async () => new Response("", { status: 401 })) as typeof fetch);
    await expect(client.checkToken()).rejects.toThrow(/didn't accept that token/);
  });

  it("lists the repositories a token can reach", async () => {
    const fetchFn = vi.fn(async () =>
      Response.json([{ name: "notes", full_name: "kev/notes", owner: { login: "kev" }, default_branch: "main", private: true }]),
    );
    const client = new GitHubClient(async () => "t", fetchFn as unknown as typeof fetch);
    expect(await client.listUserRepos()).toEqual([
      { owner: "kev", name: "notes", fullName: "kev/notes", defaultBranch: "main", private: true },
    ]);
  });
});

describe("canWrite", () => {
  const client = (status: number) =>
    new GitHubClient(async () => "t", (async () =>
      status === 201 ? Response.json({ sha: "e69de29" }, { status }) : Response.json({ message: "no" }, { status })) as typeof fetch);
  it("is true when an empty blob can be saved", async () => {
    expect(await client(201).canWrite("me", "notes")).toBe(true);
  });
  it("is false for repositories the token can only read", async () => {
    expect(await client(403).canWrite("me", "site")).toBe(false);
    expect(await client(404).canWrite("me", "site")).toBe(false);
  });
  it("can't tell for an empty repository", async () => {
    expect(await client(409).canWrite("me", "new")).toBeNull();
  });
});

describe("writableRepos", () => {
  it("keeps repositories the token can write to, and empty ones it can't check", async () => {
    const fetchFn = (async (url: string) => {
      if (url.includes("/repos/me/notes/")) return Response.json({ sha: "e69de29" }, { status: 201 });
      if (url.includes("/repos/me/new/")) return Response.json({ message: "Git Repository is empty." }, { status: 409 });
      return Response.json({ message: "Resource not accessible by personal access token" }, { status: 403 });
    }) as unknown as typeof fetch;
    const repo = (name: string) => ({ owner: "me", name, fullName: `me/${name}`, defaultBranch: "main", private: false });
    const client = new GitHubClient(async () => "t", fetchFn);
    const out = await client.writableRepos([repo("site"), repo("notes"), repo("new"), repo("blog")]);
    expect(out.map((r) => r.name)).toEqual(["notes", "new"]);
  });
});
