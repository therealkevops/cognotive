import { gitBlobSha } from "./hash";
import { RemoteMovedError, type Change, type Head, type RemoteRepo } from "./remote";

/**
 * In-memory stand-in for a GitHub branch, for tests. Commits are snapshots of
 * path → content; `push` simulates someone else (e.g. Obsidian) committing.
 */
export class FakeRemote implements RemoteRepo {
  private commits = new Map<string, Map<string, string | Uint8Array>>();
  private blobs = new Map<string, string | Uint8Array>();
  private headId: string | null = null;
  private n = 0;
  commitCount = 0;
  /** Set to make the next commit fail as if someone pushed just before us. */
  raceOnNextCommit: Map<string, string | Uint8Array | null> | null = null;

  async head(): Promise<Head | null> {
    return this.headId ? { commit: this.headId, tree: `tree-${this.headId}` } : null;
  }

  async files(tree: string): Promise<Map<string, string>> {
    const snap = this.commits.get(tree.replace(/^tree-/, ""))!;
    const out = new Map<string, string>();
    for (const [path, content] of snap) out.set(path, await this.store(content));
    return out;
  }

  async readBlob(sha: string): Promise<string> {
    const c = this.blobs.get(sha);
    if (c === undefined) throw new Error(`no blob ${sha}`);
    return typeof c === "string" ? c : new TextDecoder().decode(c);
  }

  async readBlobBytes(sha: string): Promise<Uint8Array> {
    const c = this.blobs.get(sha);
    if (c === undefined) throw new Error(`no blob ${sha}`);
    return typeof c === "string" ? new TextEncoder().encode(c) : c;
  }

  async commit(parent: Head | null, changes: Change[]): Promise<Head> {
    if (this.raceOnNextCommit) {
      const race = this.raceOnNextCommit;
      this.raceOnNextCommit = null;
      await this.push(race);
    }
    if ((parent?.commit ?? null) !== this.headId) throw new RemoteMovedError("moved");
    const next = new Map(this.headId ? this.commits.get(this.headId) : []);
    for (const c of changes) {
      if (c.content === null) next.delete(c.path);
      else next.set(c.path, c.content);
    }
    this.commitCount++;
    return this.record(next);
  }

  /** Someone else commits. null deletes. */
  async push(files: Record<string, string | Uint8Array | null> | Map<string, string | Uint8Array | null>) {
    const next = new Map(this.headId ? this.commits.get(this.headId) : []);
    for (const [p, c] of files instanceof Map ? files : Object.entries(files)) {
      if (c === null) next.delete(p);
      else next.set(p, c);
    }
    return this.record(next);
  }

  snapshot(): Record<string, string | Uint8Array> {
    return Object.fromEntries(this.headId ? this.commits.get(this.headId)! : []);
  }

  private async record(snap: Map<string, string | Uint8Array>): Promise<Head> {
    for (const c of snap.values()) await this.store(c);
    const id = `c${++this.n}`;
    this.commits.set(id, snap);
    this.headId = id;
    return { commit: id, tree: `tree-${id}` };
  }

  private async store(content: string | Uint8Array) {
    const sha = await gitBlobSha(content);
    this.blobs.set(sha, content);
    return sha;
  }
}
