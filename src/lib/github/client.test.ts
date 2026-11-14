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

  it("lists repos across installations, following pages", async () => {
    const repo = (i: number) => ({
      name: `r${i}`,
      full_name: `o/r${i}`,
      owner: { login: "o" },
      default_branch: "main",
      private: true,
    });
    const page1 = Array.from({ length: 100 }, (_, i) => repo(i));
    const { gh } = client([
      json({ installations: [{ id: 7 }] }),
      json({ total_count: 101, repositories: page1 }),
      json({ total_count: 101, repositories: [repo(100)] }),
    ]);
    const repos = await gh.listRepos();
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
