import { merge } from "node-diff3";
import type { LocalStore } from "../vault/local-store";
import { basename, dirname, extname, isBinary, isDrawing, isWithin, joinPath, noteTitle } from "../vault/paths";
import { SETTINGS_PATH } from "../vault/settings";
import { gitBlobSha } from "./hash";
import { RemoteMovedError, type Change, type RemoteRepo } from "./remote";
import type { SyncStateStore } from "./state";

/** Text file types that sync, besides attachments (see isBinary). Other files in the repo are left alone. */
const TEXT_EXTENSIONS = new Set([".md", ".markdown", ".txt", ".excalidraw", ".canvas", ".json", ".csv"]);
/** Text types where a line-level merge is safe. JSON-based files (drawings) get conflict copies instead. */
const MERGEABLE = new Set([".md", ".markdown", ".txt", ".csv"]);

/** Hidden paths (.obsidian, .git, .github, ...) never sync. */
export function isSyncable(path: string): boolean {
  if (path === SETTINGS_PATH) return true;
  if (path.split("/").some((seg) => seg.startsWith("."))) return false;
  return TEXT_EXTENSIONS.has(extname(path)) || isBinary(path);
}

type Content = string | Uint8Array;

export interface SyncResult {
  /** Local paths created, changed or deleted by remote changes (or merges). */
  changedLocally: string[];
  /** Local paths whose changes were committed. */
  pushed: string[];
  /** Conflict copies created ("Note (conflict 2026-11-14).md"). */
  conflicts: string[];
  /** Paths left for the next sync because the user edited them during this one. */
  deferred: string[];
  commit: string | null;
}

interface LocalWrite {
  path: string;
  expected: Content | undefined;
  content: Content | null;
  /** Base sha to record if the write succeeds; on failure the old base is kept. */
  baseSha: string | undefined;
}

const MAX_ATTEMPTS = 4;

/**
 * Two-way sync between a LocalStore (the working copy) and a remote branch,
 * using the last synced state as the merge base:
 *
 * - changed on one side only → copy it to the other side
 * - changed on both → three-way merge for text; if lines clash, keep the
 *   remote version and save ours next to it as a conflict copy
 * - deleted on one side, edited on the other → the edit wins
 *
 * Local changes go up as one commit. If the branch moved meanwhile, the whole
 * pass is retried against the new head. Local writes are compare-and-set, so
 * typing during a sync is never overwritten.
 */
export class SyncEngine {
  constructor(
    private local: LocalStore,
    private state: SyncStateStore,
    private remote: RemoteRepo,
    private folder: string,
    private now: () => Date = () => new Date(),
  ) {}

  /** The id the remote gives this content: what `files` would list for it. */
  private id(content: Content): Promise<string> {
    return this.remote.contentId ? this.remote.contentId(content) : gitBlobSha(content);
  }

  private toRepo(path: string) {
    return joinPath(this.folder, path);
  }

  private async localFiles(): Promise<Map<string, { content: Content; sha: string }>> {
    const out = new Map<string, { content: Content; sha: string }>();
    for (const e of await this.local.list()) {
      if (e.kind !== "file" || !isSyncable(e.path)) continue;
      const content = isBinary(e.path) ? await this.local.readBinary(e.path) : (await this.local.read(e.path))?.content;
      if (content !== undefined) out.set(e.path, { content, sha: await this.id(content) });
    }
    return out;
  }

  /** Downloads made during one pass, keyed by sha (and kind), shared by prefetch and reads. */
  private downloads = new Map<string, Promise<Content>>();

  private read(path: string, sha: string): Promise<Content> {
    const binary = isBinary(path);
    const key = `${binary ? "b" : "t"}:${sha}`;
    let p = this.downloads.get(key);
    if (!p) {
      p = binary ? this.remote.readBlobBytes(sha) : this.remote.readBlob(sha);
      this.downloads.set(key, p);
    }
    return p;
  }

  /** Fetches many files at once (a first sync of a big repo), a few at a time. */
  private async prefetch(items: Array<[string, string]>, concurrency = 8): Promise<void> {
    let next = 0;
    const worker = async () => {
      while (next < items.length) {
        const [path, sha] = items[next++];
        await this.read(path, sha);
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  }

  private write(w: LocalWrite): Promise<boolean> {
    return isBinary(w.path)
      ? this.local.writeBinaryIf(w.path, w.expected as Uint8Array | undefined, w.content as Uint8Array | null)
      : this.local.writeIf(w.path, w.expected as string | undefined, w.content as string | null);
  }

  /** Number of local files changed since the last sync. */
  async pendingChanges(): Promise<number> {
    const { base } = await this.state.load();
    const local = await this.localFiles();
    let n = 0;
    for (const [path, f] of local) if (base[path] !== f.sha) n++;
    for (const path of Object.keys(base)) if (!local.has(path)) n++;
    return n;
  }

  async sync(): Promise<SyncResult> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.pass();
      } catch (e) {
        if (!(e instanceof RemoteMovedError) || attempt >= MAX_ATTEMPTS) throw e;
      }
    }
  }

  private async pass(): Promise<SyncResult> {
    const snapshot = await this.state.load();
    const base = new Map(Object.entries(snapshot.base));
    const head = await this.remote.head();

    const remote = new Map<string, string>();
    if (head) {
      for (const [repoPath, sha] of await this.remote.files(head.tree)) {
        if (!isWithin(repoPath, this.folder)) continue;
        const path = this.folder ? repoPath.slice(this.folder.length + 1) : repoPath;
        if (isSyncable(path)) remote.set(path, sha);
      }
    }
    const local = await this.localFiles();

    // Download everything this pass will need in parallel up front.
    this.downloads.clear();
    const needed: Array<[string, string]> = [];
    for (const [path, r] of remote) {
      if (local.get(path)?.sha === r) continue;
      needed.push([path, r]);
      const b = base.get(path);
      if (b && local.has(path) && b !== r && b !== local.get(path)!.sha) needed.push([path, b]);
    }
    await this.prefetch(needed);

    const pushes: Change[] = [];
    const writes: LocalWrite[] = [];
    const newBase = new Map(base);
    const conflicts: string[] = [];
    const taken = new Set([...local.keys(), ...remote.keys()]);

    const paths = new Set([...base.keys(), ...local.keys(), ...remote.keys()]);
    for (const path of [...paths].sort()) {
      const b = base.get(path);
      const l = local.get(path);
      const r = remote.get(path);
      const setBase = (sha: string | undefined) =>
        sha === undefined ? newBase.delete(path) : newBase.set(path, sha);

      if (l?.sha === r) {
        // Same on both sides (or gone from both).
        setBase(r);
      } else if (l?.sha === b) {
        // Only the remote changed: bring it down.
        writes.push({
          path,
          expected: l?.content,
          content: r === undefined ? null : await this.read(path, r),
          baseSha: r,
        });
      } else if (r === b) {
        // Only we changed: send it up.
        pushes.push({ path: this.toRepo(path), content: l?.content ?? null });
        setBase(l?.sha);
      } else if (l === undefined) {
        // We deleted it, they edited it: keep their edit.
        writes.push({ path, expected: undefined, content: await this.read(path, r!), baseSha: r });
      } else if (r === undefined) {
        // They deleted it, we edited it: keep ours.
        pushes.push({ path: this.toRepo(path), content: l.content });
        setBase(l.sha);
      } else {
        // Both edited.
        const theirs = await this.read(path, r);
        const merged =
          b !== undefined &&
          MERGEABLE.has(extname(path)) &&
          !isDrawing(path) &&
          typeof l.content === "string" &&
          typeof theirs === "string"
            ? mergeText(l.content, (await this.read(path, b)) as string, theirs)
            : null;
        if (merged !== null) {
          const sha = await this.id(merged);
          writes.push({ path, expected: l.content, content: merged, baseSha: sha });
          pushes.push({ path: this.toRepo(path), content: merged });
          // Until the local write lands, the base is what the remote will hold.
          setBase(sha);
        } else {
          const copy = conflictPath(path, this.now(), (p) => taken.has(p));
          taken.add(copy);
          conflicts.push(copy);
          // Ours moves to the copy; the original takes theirs.
          writes.push({ path: copy, expected: undefined, content: l.content, baseSha: l.sha });
          writes.push({ path, expected: l.content, content: theirs, baseSha: r });
          pushes.push({ path: this.toRepo(copy), content: l.content });
        }
      }
    }

    // Commit first: if the branch moved, nothing local has changed yet and the
    // retry starts clean.
    let newHead = head;
    if (pushes.length) {
      newHead = await this.remote.commit(head, pushes, commitMessage(pushes, this.folder));
    }

    const changedLocally: string[] = [];
    const deferred: string[] = [];
    for (const w of writes) {
      if (await this.write(w)) {
        changedLocally.push(w.path);
        if (w.baseSha === undefined) newBase.delete(w.path);
        else newBase.set(w.path, w.baseSha);
      } else {
        // Edited during sync. Keep the old base so the next pass sees both sides changed.
        deferred.push(w.path);
        const old = base.get(w.path);
        if (old === undefined) newBase.delete(w.path);
        else newBase.set(w.path, old);
      }
    }

    await this.state.save({ head: newHead, base: Object.fromEntries(newBase), syncedAt: Date.now() });
    return {
      changedLocally,
      pushed: pushes.map((p) => (this.folder ? p.path.slice(this.folder.length + 1) : p.path)),
      conflicts,
      deferred,
      commit: pushes.length ? newHead!.commit : null,
    };
  }
}

/** Line-based three-way merge. Returns null if the same lines changed differently on both sides. */
export function mergeText(ours: string, base: string, theirs: string): string | null {
  const m = merge(ours, base, theirs, { stringSeparator: "\n" });
  return m.conflict ? null : m.result.join("\n");
}

export function conflictPath(path: string, date: Date, taken: (p: string) => boolean): string {
  const ext = extname(path);
  const stem = basename(path).slice(0, basename(path).length - ext.length);
  const day = date.toISOString().slice(0, 10);
  for (let n = 1; ; n++) {
    const suffix = n === 1 ? `(conflict ${day})` : `(conflict ${day} ${n})`;
    const candidate = joinPath(dirname(path), `${stem} ${suffix}${ext}`);
    if (!taken(candidate)) return candidate;
  }
}

function commitMessage(changes: Change[], folder: string): string {
  const names = changes.map((c) => noteTitle(folder ? c.path.slice(folder.length + 1) : c.path));
  const shown = names.slice(0, 3).join(", ");
  const more = names.length > 3 ? ` and ${names.length - 3} more` : "";
  return `noted-ai: update ${shown}${more}`;
}
