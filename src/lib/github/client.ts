/**
 * Minimal GitHub REST client for the browser. Calls api.github.com directly
 * (it supports CORS) with the user's token, so note traffic never passes
 * through Vercel functions.
 */

const API = "https://api.github.com";

export class GitHubError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface RepoSummary {
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string;
  private: boolean;
}

export interface TreeEntry {
  path: string;
  type: "blob" | "tree" | "commit";
  sha: string;
  mode: string;
}

type TokenProvider = () => Promise<string>;

function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

function base64ToUtf8(b64: string): string {
  const bin = atob(b64.replace(/\s/g, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export class GitHubClient {
  constructor(
    private token: TokenProvider,
    private fetchFn: typeof fetch = (...a) => fetch(...a),
  ) {}

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.fetchFn(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${await this.token()}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
    if (!res.ok) {
      let message = `GitHub API ${method} ${path} failed (${res.status})`;
      try {
        const err = (await res.json()) as { message?: string };
        if (err.message) message = err.message;
      } catch {
        // keep the generic message
      }
      if (res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0") {
        message = "GitHub rate limit reached. Sync will retry later.";
      }
      throw new GitHubError(res.status, message);
    }
    return (res.status === 204 ? undefined : await res.json()) as T;
  }

  private repoPath(owner: string, repo: string) {
    return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  }

  /** Repositories the user has installed the app on (user-to-server tokens see only those). */
  async listRepos(): Promise<RepoSummary[]> {
    const { installations } = await this.request<{ installations: Array<{ id: number }> }>(
      "GET",
      "/user/installations?per_page=100",
    );
    const repos: RepoSummary[] = [];
    for (const inst of installations) {
      for (let page = 1; ; page++) {
        const r = await this.request<{
          total_count: number;
          repositories: Array<{
            name: string;
            full_name: string;
            owner: { login: string };
            default_branch: string;
            private: boolean;
          }>;
        }>("GET", `/user/installations/${inst.id}/repositories?per_page=100&page=${page}`);
        for (const x of r.repositories) {
          repos.push({
            owner: x.owner.login,
            name: x.name,
            fullName: x.full_name,
            defaultBranch: x.default_branch,
            private: x.private,
          });
        }
        if (r.repositories.length < 100) break;
      }
    }
    return repos.sort((a, b) => a.fullName.localeCompare(b.fullName));
  }

  async listBranches(owner: string, repo: string): Promise<string[]> {
    const r = await this.request<Array<{ name: string }>>(
      "GET",
      `${this.repoPath(owner, repo)}/branches?per_page=100`,
    );
    return r.map((b) => b.name);
  }

  /** The commit a branch points at, or null if the branch (or the whole repo) is empty. */
  async branchHead(owner: string, repo: string, branch: string): Promise<string | null> {
    try {
      const r = await this.request<{ object: { sha: string } }>(
        "GET",
        `${this.repoPath(owner, repo)}/git/ref/heads/${encodeURIComponent(branch)}`,
      );
      return r.object.sha;
    } catch (e) {
      // 404: no such branch. 409: "Git Repository is empty."
      if (e instanceof GitHubError && (e.status === 404 || e.status === 409)) return null;
      throw e;
    }
  }

  async commitTree(owner: string, repo: string, commitSha: string): Promise<string> {
    const r = await this.request<{ tree: { sha: string } }>(
      "GET",
      `${this.repoPath(owner, repo)}/git/commits/${commitSha}`,
    );
    return r.tree.sha;
  }

  async tree(owner: string, repo: string, treeSha: string): Promise<TreeEntry[]> {
    const r = await this.request<{ tree: TreeEntry[]; truncated: boolean }>(
      "GET",
      `${this.repoPath(owner, repo)}/git/trees/${treeSha}?recursive=1`,
    );
    if (r.truncated) {
      throw new GitHubError(413, "This repository is too large to list in one request. Use a smaller vault folder.");
    }
    return r.tree;
  }

  async blob(owner: string, repo: string, sha: string): Promise<string> {
    const r = await this.request<{ content: string; encoding: string }>(
      "GET",
      `${this.repoPath(owner, repo)}/git/blobs/${sha}`,
    );
    return r.encoding === "base64" ? base64ToUtf8(r.content) : r.content;
  }

  async createBlob(owner: string, repo: string, content: string): Promise<string> {
    const r = await this.request<{ sha: string }>("POST", `${this.repoPath(owner, repo)}/git/blobs`, {
      content: utf8ToBase64(content),
      encoding: "base64",
    });
    return r.sha;
  }

  async createTree(
    owner: string,
    repo: string,
    baseTree: string | null,
    entries: Array<{ path: string; sha: string | null }>,
  ): Promise<string> {
    const r = await this.request<{ sha: string }>("POST", `${this.repoPath(owner, repo)}/git/trees`, {
      ...(baseTree ? { base_tree: baseTree } : {}),
      tree: entries.map((e) => ({ path: e.path, mode: "100644", type: "blob", sha: e.sha })),
    });
    return r.sha;
  }

  async createCommit(owner: string, repo: string, message: string, tree: string, parents: string[]) {
    const r = await this.request<{ sha: string }>("POST", `${this.repoPath(owner, repo)}/git/commits`, {
      message,
      tree,
      parents,
    });
    return r.sha;
  }

  /** Fast-forwards a branch. Throws GitHubError 422 if someone else pushed first. */
  async updateBranch(owner: string, repo: string, branch: string, sha: string): Promise<void> {
    await this.request("PATCH", `${this.repoPath(owner, repo)}/git/refs/heads/${encodeURIComponent(branch)}`, {
      sha,
      force: false,
    });
  }

  async createBranch(owner: string, repo: string, branch: string, sha: string): Promise<void> {
    await this.request("POST", `${this.repoPath(owner, repo)}/git/refs`, { ref: `refs/heads/${branch}`, sha });
  }

  /** Creates a file with the Contents API: the only way to make the first commit in an empty repo. */
  async putFile(owner: string, repo: string, branch: string, path: string, content: string, message: string) {
    await this.request("PUT", `${this.repoPath(owner, repo)}/contents/${path.split("/").map(encodeURIComponent).join("/")}`, {
      message,
      content: utf8ToBase64(content),
      branch,
    });
  }
}

export { base64ToUtf8, utf8ToBase64 };
