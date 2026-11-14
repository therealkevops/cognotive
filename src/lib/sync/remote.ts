import { GitHubClient, GitHubError } from "../github/client";

export interface Head {
  commit: string;
  tree: string;
}

/** A change to push: new content, or null to delete. Paths are repo paths. */
export interface Change {
  path: string;
  content: string | null;
}

/** Thrown when the branch moved since we read it; sync re-reads and retries. */
export class RemoteMovedError extends Error {}

/** What the sync engine needs from a remote. GitHubRemote below; tests use a fake. */
export interface RemoteRepo {
  /** Current branch head, or null if the branch has no commits yet. */
  head(): Promise<Head | null>;
  /** Every blob in the tree: repo path → blob sha. */
  files(tree: string): Promise<Map<string, string>>;
  readBlob(sha: string): Promise<string>;
  /** Commits `changes` on top of `parent` and moves the branch. */
  commit(parent: Head | null, changes: Change[], message: string): Promise<Head>;
}

export class GitHubRemote implements RemoteRepo {
  constructor(
    private client: GitHubClient,
    readonly owner: string,
    readonly repo: string,
    readonly branch: string,
  ) {}

  async head(): Promise<Head | null> {
    const commit = await this.client.branchHead(this.owner, this.repo, this.branch);
    if (!commit) return null;
    return { commit, tree: await this.client.commitTree(this.owner, this.repo, commit) };
  }

  async files(tree: string): Promise<Map<string, string>> {
    const entries = await this.client.tree(this.owner, this.repo, tree);
    return new Map(entries.filter((e) => e.type === "blob").map((e) => [e.path, e.sha]));
  }

  readBlob(sha: string): Promise<string> {
    return this.client.blob(this.owner, this.repo, sha);
  }

  async commit(parent: Head | null, changes: Change[], message: string): Promise<Head> {
    const { client, owner, repo, branch } = this;
    let base = parent;
    let todo = changes;

    if (!base) {
      // Git Data endpoints refuse to work on an empty repository, so the first
      // file goes in through the Contents API, which creates the branch too.
      const first = todo.find((c) => c.content !== null);
      if (!first) throw new Error("Nothing to commit.");
      try {
        await client.putFile(owner, repo, branch, first.path, first.content!, message);
      } catch (e) {
        // 422 here means the repo isn't empty but the branch doesn't exist yet,
        // or the file appeared meanwhile; let sync re-read and retry.
        if (e instanceof GitHubError && (e.status === 409 || e.status === 422)) throw new RemoteMovedError(e.message);
        throw e;
      }
      todo = todo.filter((c) => c !== first);
      base = await this.head();
      if (!base) throw new RemoteMovedError("Branch not found after the first commit.");
      if (todo.length === 0) return base;
    }

    const entries = await Promise.all(
      todo.map(async (c) => ({
        path: c.path,
        sha: c.content === null ? null : await client.createBlob(owner, repo, c.content),
      })),
    );
    const tree = await client.createTree(owner, repo, base.tree, entries);
    const commit = await client.createCommit(owner, repo, message, tree, [base.commit]);
    try {
      await client.updateBranch(owner, repo, branch, commit);
    } catch (e) {
      if (e instanceof GitHubError && e.status === 422) throw new RemoteMovedError(e.message);
      throw e;
    }
    return { commit, tree };
  }
}
