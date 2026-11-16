import { createHash } from "node:crypto";
import type { Page, Route } from "@playwright/test";

const blobSha = (content: string | Buffer) => {
  const body = typeof content === "string" ? Buffer.from(content, "utf8") : content;
  return createHash("sha1").update(Buffer.concat([Buffer.from(`blob ${body.length}\0`), body])).digest("hex");
};

/**
 * Just enough of the GitHub REST API for sync, served to the browser through
 * Playwright route interception. One repo ("me/notes"), one branch ("main").
 */
export class FakeGitHub {
  blobs = new Map<string, Buffer>();
  trees = new Map<string, Map<string, string>>(); // tree sha → path → blob sha
  commits = new Map<string, { tree: string; parents: string[]; message: string }>();
  head: string | null = null;
  private n = 0;

  constructor(files: Record<string, string>) {
    this.push(files, "initial");
  }

  /** Someone else commits (e.g. from Obsidian). */
  push(files: Record<string, string | Buffer | null>, message = "external") {
    const current = new Map(this.head ? this.trees.get(this.commits.get(this.head)!.tree) : []);
    for (const [p, c] of Object.entries(files)) {
      if (c === null) current.delete(p);
      else {
        const buf = typeof c === "string" ? Buffer.from(c, "utf8") : c;
        const sha = blobSha(buf);
        this.blobs.set(sha, buf);
        current.set(p, sha);
      }
    }
    const tree = `t${++this.n}`;
    this.trees.set(tree, current);
    const commit = `c${this.n}`;
    this.commits.set(commit, { tree, parents: this.head ? [this.head] : [], message });
    this.head = commit;
  }

  /** Text of every file in the head commit. */
  files(): Record<string, string> {
    const tree = this.trees.get(this.commits.get(this.head!)!.tree)!;
    return Object.fromEntries([...tree].map(([p, sha]) => [p, this.blobs.get(sha)!.toString("utf8")]));
  }

  bytes(path: string): Buffer | undefined {
    const tree = this.trees.get(this.commits.get(this.head!)!.tree)!;
    const sha = tree.get(path);
    return sha ? this.blobs.get(sha) : undefined;
  }

  /** Authorization headers seen, to check which credential the app used. */
  auth = new Set<string>();
  /** When the personal access token expires (sent in GitHub's header), or null. */
  tokenExpiry: string | null = "2027-02-01 00:00:00 UTC";

  /** Serves the fake API to the page. */
  async install(page: Page) {
    await page.route("https://api.github.com/**", (route) => this.handle(route));
  }

  private async handle(route: Route) {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    const method = req.method();
    const body = req.postData() ? JSON.parse(req.postData()!) : undefined;
    const ok = (json: unknown, status = 200) =>
      route.fulfill({ status, json, headers: { "Access-Control-Allow-Origin": "*" } });

    if (method === "OPTIONS") {
      return route.fulfill({
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "*",
          "Access-Control-Allow-Methods": "GET,POST,PATCH,PUT",
        },
      });
    }
    const authz = req.headers()["authorization"];
    if (authz) this.auth.add(authz);
    if (authz === "Bearer revoked") return ok({ message: "Bad credentials" }, 401);
    if (path === "/user") {
      return route.fulfill({
        status: 200,
        json: { login: "tester", id: 1 },
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Expose-Headers": "github-authentication-token-expiration",
          ...(this.tokenExpiry ? { "github-authentication-token-expiration": this.tokenExpiry } : {}),
        },
      });
    }
    if (path === "/user/repos") {
      return ok([{ name: "notes", full_name: "me/notes", owner: { login: "me" }, default_branch: "main", private: true }]);
    }
    if (path === "/user/installations") return ok({ installations: [{ id: 1 }] });
    if (path === "/user/installations/1/repositories") {
      return ok({
        total_count: 1,
        repositories: [{ name: "notes", full_name: "me/notes", owner: { login: "me" }, default_branch: "main", private: true }],
      });
    }
    const repo = "/repos/me/notes";
    if (path === `${repo}/branches`) return ok([{ name: "main" }]);
    if (path === `${repo}/git/ref/heads/main`) {
      return this.head ? ok({ object: { sha: this.head } }) : ok({ message: "Not Found" }, 404);
    }
    let m: RegExpMatchArray | null;
    if ((m = path.match(/\/git\/commits\/(\w+)$/))) return ok({ tree: { sha: this.commits.get(m[1])!.tree } });
    if ((m = path.match(/\/git\/trees\/(\w+)$/))) {
      const tree = this.trees.get(m[1])!;
      return ok({ truncated: false, tree: [...tree].map(([p, sha]) => ({ path: p, type: "blob", sha, mode: "100644" })) });
    }
    if ((m = path.match(/\/git\/blobs\/(\w+)$/))) {
      return ok({ encoding: "base64", content: this.blobs.get(m[1])!.toString("base64") });
    }
    if (method === "POST" && path === `${repo}/git/blobs`) {
      const content = Buffer.from(body.content, "base64");
      const sha = blobSha(content);
      this.blobs.set(sha, content);
      return ok({ sha }, 201);
    }
    if (method === "POST" && path === `${repo}/git/trees`) {
      const tree = new Map(body.base_tree ? this.trees.get(body.base_tree) : []);
      for (const e of body.tree) {
        if (e.sha === null) tree.delete(e.path);
        else tree.set(e.path, e.sha);
      }
      const sha = `t${++this.n}`;
      this.trees.set(sha, tree);
      return ok({ sha }, 201);
    }
    if (method === "POST" && path === `${repo}/git/commits`) {
      const sha = `c${++this.n}`;
      this.commits.set(sha, { tree: body.tree, parents: body.parents, message: body.message });
      return ok({ sha }, 201);
    }
    if (method === "GET" && path === `${repo}/commits`) {
      // Commits on main that changed `path`, newest first.
      const file = url.searchParams.get("path")!;
      const out = [];
      for (let c = this.head; c; c = this.commits.get(c)!.parents[0] ?? null) {
        const info = this.commits.get(c)!;
        const mine = this.trees.get(info.tree)!.get(file);
        const parent = info.parents[0] ? this.trees.get(this.commits.get(info.parents[0])!.tree)!.get(file) : undefined;
        if (mine !== parent) {
          out.push({
            sha: c,
            html_url: `https://github.com/me/notes/commit/${c}`,
            commit: { message: info.message, author: { name: "tester", date: new Date(2026, 10, 14, 9, out.length).toISOString() } },
          });
        }
      }
      return ok(out);
    }
    if ((m = path.match(/^\/repos\/me\/notes\/contents\/(.+)$/)) && method === "GET") {
      const ref = url.searchParams.get("ref")!;
      const sha = this.trees.get(this.commits.get(ref)!.tree)!.get(decodeURIComponent(m[1]));
      if (!sha) return ok({ message: "Not Found" }, 404);
      return ok({ sha, encoding: "base64", content: this.blobs.get(sha)!.toString("base64") });
    }
    if (method === "PATCH" && path === `${repo}/git/refs/heads/main`) {
      const parent = this.commits.get(body.sha)!.parents[0];
      if (parent !== this.head) return ok({ message: "Update is not a fast forward" }, 422);
      this.head = body.sha;
      return ok({ object: { sha: body.sha } });
    }
    return ok({ message: `Fake GitHub has no route for ${method} ${path}` }, 404);
  }
}
