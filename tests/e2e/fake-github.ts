import { createHash } from "node:crypto";
import type { Page, Route } from "@playwright/test";

const blobSha = (content: string) => {
  const body = Buffer.from(content, "utf8");
  return createHash("sha1").update(Buffer.concat([Buffer.from(`blob ${body.length}\0`), body])).digest("hex");
};

/**
 * Just enough of the GitHub REST API for sync, served to the browser through
 * Playwright route interception. One repo ("me/notes"), one branch ("main").
 */
export class FakeGitHub {
  blobs = new Map<string, string>();
  trees = new Map<string, Map<string, string>>(); // tree sha → path → blob sha
  commits = new Map<string, { tree: string; parents: string[]; message: string }>();
  head: string | null = null;
  private n = 0;

  constructor(files: Record<string, string>) {
    this.push(files, "initial");
  }

  /** Someone else commits (e.g. from Obsidian). */
  push(files: Record<string, string | null>, message = "external") {
    const current = new Map(this.head ? this.trees.get(this.commits.get(this.head)!.tree) : []);
    for (const [p, c] of Object.entries(files)) {
      if (c === null) current.delete(p);
      else {
        const sha = blobSha(c);
        this.blobs.set(sha, c);
        current.set(p, sha);
      }
    }
    const tree = `t${++this.n}`;
    this.trees.set(tree, current);
    const commit = `c${this.n}`;
    this.commits.set(commit, { tree, parents: this.head ? [this.head] : [], message });
    this.head = commit;
  }

  files(): Record<string, string> {
    const tree = this.trees.get(this.commits.get(this.head!)!.tree)!;
    return Object.fromEntries([...tree].map(([p, sha]) => [p, this.blobs.get(sha)!]));
  }

  async install(page: Page) {
    await page.route("**/api/auth/token", (route) =>
      route.fulfill({
        json: { token: "ghu_test", expiresAt: Date.now() + 8 * 3600_000, user: { id: 1, login: "tester" }, installUrl: null },
      }),
    );
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
      return ok({ encoding: "base64", content: Buffer.from(this.blobs.get(m[1])!, "utf8").toString("base64") });
    }
    if (method === "POST" && path === `${repo}/git/blobs`) {
      const content = Buffer.from(body.content, "base64").toString("utf8");
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
    if (method === "PATCH" && path === `${repo}/git/refs/heads/main`) {
      const parent = this.commits.get(body.sha)!.parents[0];
      if (parent !== this.head) return ok({ message: "Update is not a fast forward" }, 422);
      this.head = body.sha;
      return ok({ object: { sha: body.sha } });
    }
    return ok({ message: `Fake GitHub has no route for ${method} ${path}` }, 404);
  }
}
