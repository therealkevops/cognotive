import { diff3Merge, merge } from "node-diff3";
import type { LocalStore } from "../vault/local-store";
import { basename, dirname, extname, isBinary, isDrawing, isWithin, joinPath, noteTitle } from "../vault/paths";
import { PROPERTIES_PATH } from "../vault/file-properties";
import { SETTINGS_PATH } from "../vault/settings";
import { gitBlobSha } from "./hash";
import { RemoteMovedError, type Change, type RemoteRepo } from "./remote";
import type { SyncSnapshot, SyncStateStore } from "./state";

/** Text file types that sync, besides attachments (see isBinary). Other files in the repo are left alone. */
const TEXT_EXTENSIONS = new Set([".md", ".markdown", ".txt", ".excalidraw", ".canvas", ".json", ".csv"]);
/** Text types where a line-level merge is safe. JSON-based files (drawings) get conflict copies instead. */
const MERGEABLE = new Set([".md", ".markdown", ".txt", ".csv"]);

/** Hidden paths (.obsidian, .git, .github, ...) never sync. */
export function isSyncable(path: string): boolean {
  if (path === SETTINGS_PATH || path === PROPERTIES_PATH) return true;
  if (path.split("/").some((seg) => seg.startsWith("."))) return false;
  return TEXT_EXTENSIONS.has(extname(path)) || isBinary(path);
}

type Content = string | Uint8Array;

export interface SyncResult {
  /** Local paths created, changed or deleted by remote changes (or merges). */
  changedLocally: string[];
  /** Local paths whose changes were committed. */
  pushed: string[];
  /**
   * Files changed differently here and on the remote. Each now holds the
   * remote's version of the conflicting part (with every other change from
   * both sides); what was here is in the conflict, to review and resolve.
   */
  conflicts: SyncConflict[];
  /** Paths left for the next sync because the user edited them during this one. */
  deferred: string[];
  commit: string | null;
}

export interface SyncConflict {
  path: string;
  /** This device's version when the conflict was found. */
  ours: Content;
  /** The remote's version. */
  theirs: Content;
  /** The last version both sides had (text files), if known. */
  base?: string;
  /** Line-by-line review (notes and other text) or a choice of whole file. */
  kind: "text" | "file";
  at: number;
}

interface LocalFile {
  sha: string;
  /** The file's content as it was when `sha` was worked out; null if it has changed since. */
  load(): Promise<Content | null>;
}

interface LocalWrite {
  path: string;
  expected: Content | undefined;
  content: Content | null;
  /** Base sha to record if the write succeeds; on failure the old base is kept. */
  baseSha: string | undefined;
  /** Reported only if the write lands (otherwise the next pass meets it again). */
  conflict?: SyncConflict;
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

  /** Local files' ids by modification time, so unchanged files aren't read and hashed again. */
  private hashes: Map<string, { mtime: number; sha: string }> | null = null;
  private scheme: Promise<string> | null = null;

  private async loadHashes(snapshot: SyncSnapshot) {
    this.scheme ??= this.id("");
    const scheme = await this.scheme;
    if (!this.hashes) this.hashes = new Map(snapshot.scheme === scheme ? Object.entries(snapshot.hashes ?? {}) : []);
    return scheme;
  }

  /**
   * Every syncable local file with its id. Contents are read only for files changed since
   * they were last hashed (and later on demand, through `load`).
   */
  private async localFiles(snapshot: SyncSnapshot): Promise<Map<string, LocalFile>> {
    await this.loadHashes(snapshot);
    const hashes = this.hashes!;
    const out = new Map<string, LocalFile>();
    const seen = new Set<string>();
    for (const e of await this.local.list()) {
      if (e.kind !== "file" || !isSyncable(e.path)) continue;
      seen.add(e.path);
      let loaded: Promise<Content | undefined> | null = null;
      const read = () =>
        (loaded ??= isBinary(e.path) ? this.local.readBinary(e.path) : this.local.read(e.path).then((f) => f?.content));
      const known = hashes.get(e.path);
      let sha = known?.mtime === e.mtime ? known.sha : undefined;
      const fromCache = sha !== undefined;
      if (sha === undefined) {
        const content = await read();
        if (content === undefined) continue;
        sha = await this.id(content);
        // Trusted next time only if hashed after the write's millisecond: a later write gets a later time.
        if (Date.now() > e.mtime) hashes.set(e.path, { mtime: e.mtime, sha });
        else hashes.delete(e.path);
      }
      const id = sha;
      let checked: Promise<Content | null> | null = null;
      out.set(e.path, {
        sha,
        // Read later than it was hashed: make sure it's still the same (it may have been typed in).
        load: () =>
          (checked ??= read().then(async (c) => {
            if (c !== undefined && (!fromCache || (await this.id(c)) === id)) return c;
            hashes.delete(e.path); // hash it afresh next time
            return null;
          })),
      });
    }
    for (const path of [...hashes.keys()]) if (!seen.has(path)) hashes.delete(path);
    return out;
  }

  /** The remote's syncable files at a tree, from the last listing if the tree hasn't changed. */
  private async remoteFiles(tree: string, cached: SyncSnapshot["remoteTree"]): Promise<Map<string, string>> {
    if (cached?.tree === tree) return new Map(Object.entries(cached.files));
    const remote = new Map<string, string>();
    for (const [repoPath, sha] of await this.remote.files(tree)) {
      if (!isWithin(repoPath, this.folder)) continue;
      const path = this.folder ? repoPath.slice(this.folder.length + 1) : repoPath;
      if (isSyncable(path)) remote.set(path, sha);
    }
    return remote;
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
    const snapshot = await this.state.load();
    const { base } = snapshot;
    const local = await this.localFiles(snapshot);
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

    const remote = head ? await this.remoteFiles(head.tree, snapshot.remoteTree) : new Map<string, string>();
    const local = await this.localFiles(snapshot);

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
    const deferred: string[] = [];
    const newBase = new Map(base);
    const conflicts: SyncConflict[] = [];

    const paths = new Set([...base.keys(), ...local.keys(), ...remote.keys()]);
    for (const path of [...paths].sort()) {
      const b = base.get(path);
      const l = local.get(path);
      const r = remote.get(path);
      const setBase = (sha: string | undefined) =>
        sha === undefined ? newBase.delete(path) : newBase.set(path, sha);

      // Our content, as hashed; null: edited since, so it waits for the next pass.
      const mine = async () => (l ? await l.load() : undefined);

      if (l?.sha === r) {
        // Same on both sides (or gone from both).
        setBase(r);
      } else if (l?.sha === b) {
        // Only the remote changed: bring it down.
        const expected = await mine();
        if (expected === null) {
          deferred.push(path);
          continue;
        }
        writes.push({
          path,
          expected,
          content: r === undefined ? null : await this.read(path, r),
          baseSha: r,
        });
      } else if (r === b) {
        // Only we changed: send it up.
        const content = await mine();
        if (content === null) {
          deferred.push(path);
          continue;
        }
        pushes.push({ path: this.toRepo(path), content: content ?? null });
        setBase(l?.sha);
      } else if (l === undefined) {
        // We deleted it, they edited it: keep their edit.
        writes.push({ path, expected: undefined, content: await this.read(path, r!), baseSha: r });
      } else if (r === undefined) {
        // They deleted it, we edited it: keep ours.
        const content = await l.load();
        if (content === null) {
          deferred.push(path);
          continue;
        }
        pushes.push({ path: this.toRepo(path), content });
        setBase(l.sha);
      } else {
        // Both edited.
        const ours = await l.load();
        if (ours === null) {
          deferred.push(path);
          continue;
        }
        const theirs = await this.read(path, r);
        const baseContent = b !== undefined ? await this.read(path, b) : undefined;
        const text =
          MERGEABLE.has(extname(path)) && !isDrawing(path) && typeof ours === "string" && typeof theirs === "string";
        const baseText = typeof baseContent === "string" ? baseContent : text && b === undefined ? "" : undefined;
        const merged = text && baseText !== undefined ? mergeText(ours as string, baseText, theirs as string) : null;
        const conflict = (kind: SyncConflict["kind"]): SyncConflict => ({
          path,
          ours: ours,
          theirs,
          ...(typeof baseContent === "string" ? { base: baseContent } : text ? { base: "" } : {}),
          kind,
          at: this.now().getTime(),
        });
        if (merged !== null) {
          const sha = await this.id(merged);
          writes.push({ path, expected: ours, content: merged, baseSha: sha });
          pushes.push({ path: this.toRepo(path), content: merged });
          // Until the local write lands, the base is what the remote will hold.
          setBase(sha);
        } else if (text && baseText !== undefined) {
          // Everything that merges, merged; where the same lines changed, the remote's
          // lines for now. Ours is kept in the conflict for review.
          const resolved = mergeTheirs(ours as string, baseText, theirs as string);
          const sha = await this.id(resolved);
          writes.push({ path, expected: ours, content: resolved, baseSha: sha, conflict: conflict("text") });
          if (sha !== r) pushes.push({ path: this.toRepo(path), content: resolved });
          setBase(sha);
        } else {
          // Drawings, canvases, attachments: the remote's file for now, ours kept in the conflict.
          writes.push({ path, expected: ours, content: theirs, baseSha: r, conflict: conflict("file") });
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
    for (const w of writes) {
      if (await this.write(w)) {
        changedLocally.push(w.path);
        if (w.conflict) conflicts.push(w.conflict);
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

    const scheme = await this.loadHashes(snapshot);
    await this.state.save({
      head: newHead,
      base: Object.fromEntries(newBase),
      syncedAt: Date.now(),
      hashes: Object.fromEntries(this.hashes!),
      scheme,
      // The listing is still right if nothing was committed; after a commit the next pass lists the new tree.
      ...(head && !pushes.length ? { remoteTree: { tree: head.tree, files: Object.fromEntries(remote) } } : {}),
    });
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

/**
 * Line-based three-way merge that settles conflicts in the remote's favour:
 * every change that merges cleanly is kept, and where both sides changed the
 * same lines the remote's lines are used.
 */
export function mergeTheirs(ours: string, base: string, theirs: string): string {
  const sep = "\n";
  const blocks = diff3Merge(ours.split(sep), base.split(sep), theirs.split(sep), { stringSeparator: sep });
  return blocks.flatMap((b) => (b.ok ? b.ok : b.conflict!.b)).join(sep);
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
  return `CogNotive.ai: update ${shown}${more}`;
}
