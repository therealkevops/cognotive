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

export interface FileCommit {
  sha: string;
  /** First line of the commit message. */
  message: string;
  author: string;
  /** ISO date. */
  date: string;
  url: string;
}

export interface TreeEntry {
  path: string;
  type: "blob" | "tree" | "commit";
  sha: string;
  mode: string;
}

type TokenProvider = () => Promise<string>;

/** GitHub's token expiry header, e.g. "2026-12-01 00:00:00 UTC" or "… -0700", as a timestamp. */
export function parseTokenExpiry(header: string | null): number | null {
  const m = header?.trim().match(/^(\d{4}-\d\d-\d\d) (\d\d:\d\d:\d\d) (UTC|[+-]\d{4})$/);
  if (!m) return null;
  const zone = m[3] === "UTC" ? "Z" : `${m[3].slice(0, 3)}:${m[3].slice(3)}`;
  const t = Date.parse(`${m[1]}T${m[2]}${zone}`);
  return Number.isFinite(t) ? t : null;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64.replace(/\s/g, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

const utf8ToBase64 = (text: string) => bytesToBase64(new TextEncoder().encode(text));
const base64ToUtf8 = (b64: string) => new TextDecoder().decode(base64ToBytes(b64));
const toBase64 = (c: string | Uint8Array) => (typeof c === "string" ? utf8ToBase64(c) : bytesToBase64(c));

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

  /**
   * Checks a personal access token: who it belongs to, and when it expires
   * (from GitHub's expiration header; null for tokens that don't expire).
   */
  async checkToken(): Promise<{ login: string; id: number; expiresAt: number | null }> {
    const res = await this.fetchFn(`${API}/user`, {
      headers: {
        Authorization: `Bearer ${await this.token()}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      cache: "no-store",
    });
    if (!res.ok) {
      throw new GitHubError(
        res.status,
        res.status === 401 ? "GitHub didn't accept that token. Check it was copied in full and hasn't expired." : `GitHub returned an error (${res.status}).`,
      );
    }
    const user = (await res.json()) as { login: string; id: number };
    return {
      login: user.login,
      id: user.id,
      expiresAt: parseTokenExpiry(res.headers.get("github-authentication-token-expiration")),
    };
  }

  /** Repositories a personal access token can reach. */
  async listUserRepos(): Promise<RepoSummary[]> {
    const repos: RepoSummary[] = [];
    for (let page = 1; page <= 10; page++) {
      const r = await this.request<
        Array<{ name: string; full_name: string; owner: { login: string }; default_branch: string; private: boolean }>
      >("GET", `/user/repos?per_page=100&page=${page}&sort=updated`);
      for (const x of r) {
        repos.push({ owner: x.owner.login, name: x.name, fullName: x.full_name, defaultBranch: x.default_branch, private: x.private });
      }
      if (r.length < 100) break;
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
    return new TextDecoder().decode(await this.blobBytes(owner, repo, sha));
  }

  async blobBytes(owner: string, repo: string, sha: string): Promise<Uint8Array> {
    const r = await this.request<{ content: string; encoding: string }>(
      "GET",
      `${this.repoPath(owner, repo)}/git/blobs/${sha}`,
    );
    return r.encoding === "base64" ? base64ToBytes(r.content) : new TextEncoder().encode(r.content);
  }

  async createBlob(owner: string, repo: string, content: string | Uint8Array): Promise<string> {
    const r = await this.request<{ sha: string }>("POST", `${this.repoPath(owner, repo)}/git/blobs`, {
      content: toBase64(content),
      encoding: "base64",
    });
    return r.sha;
  }

  /**
   * Whether the token can write to a repository. Every token can read public
   * repositories, so being listed isn't enough. Tests by saving an empty blob:
   * it isn't attached to any commit, so nothing in the repository changes.
   * null when GitHub can't say (an empty repository refuses blobs).
   */
  async canWrite(owner: string, repo: string): Promise<boolean | null> {
    try {
      await this.createBlob(owner, repo, "");
      return true;
    } catch (e) {
      if (e instanceof GitHubError && (e.status === 403 || e.status === 404)) return false;
      if (e instanceof GitHubError && e.status === 409) return null;
      throw e;
    }
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

  /** Commits on `branch` that touched `path`, newest first. */
  async fileHistory(owner: string, repo: string, branch: string, path: string, perPage = 30): Promise<FileCommit[]> {
    const q = new URLSearchParams({ sha: branch, path, per_page: String(perPage) });
    const r = await this.request<
      Array<{
        sha: string;
        html_url: string;
        commit: { message: string; author: { name: string; date: string } | null };
      }>
    >("GET", `${this.repoPath(owner, repo)}/commits?${q}`);
    return r.map((c) => ({
      sha: c.sha,
      message: c.commit.message.split("\n")[0],
      author: c.commit.author?.name ?? "",
      date: c.commit.author?.date ?? "",
      url: c.html_url,
    }));
  }

  /** A file's content at a commit, or null if it didn't exist there. */
  async fileAt(owner: string, repo: string, ref: string, path: string): Promise<Uint8Array | null> {
    try {
      const r = await this.request<{ content?: string; encoding?: string; sha: string }>(
        "GET",
        `${this.repoPath(owner, repo)}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(ref)}`,
      );
      // Files over 1 MB come back without content; fetch the blob instead.
      if (r.encoding === "base64" && r.content) return base64ToBytes(r.content);
      return this.blobBytes(owner, repo, r.sha);
    } catch (e) {
      if (e instanceof GitHubError && e.status === 404) return null;
      throw e;
    }
  }

  /** Creates a file with the Contents API: the only way to make the first commit in an empty repo. */
  async putFile(owner: string, repo: string, branch: string, path: string, content: string | Uint8Array, message: string) {
    await this.request("PUT", `${this.repoPath(owner, repo)}/contents/${path.split("/").map(encodeURIComponent).join("/")}`, {
      message,
      content: toBase64(content),
      branch,
    });
  }
}

export { base64ToBytes, base64ToUtf8, bytesToBase64, utf8ToBase64 };
