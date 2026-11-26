import { isBinary, joinPath, normalizePath, uniquePath } from "./paths";
import type { VaultStore } from "./types";

/*
 * Merging one repository into another (say, notes kept only in this browser into a repository
 * synced with GitHub): every file is copied across, under a folder or at the top level. Nothing
 * in the destination is overwritten.
 */

export interface MergeResult {
  added: number;
  /** Already there, the same. */
  skipped: number;
  /** A different file had the name: added under a new one ("Plan 1.md"). */
  renamed: number;
  /** The destination's new files. */
  paths: string[];
}

const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);
const bytesOf = async (store: VaultStore, path: string): Promise<Uint8Array | undefined> => {
  if (isBinary(path)) return store.readBinary(path);
  const f = await store.read(path);
  return f ? new TextEncoder().encode(f.content) : undefined;
};

/**
 * Copies the source's files into the destination, under `folder` ("" for the top level). The
 * source's own settings and hidden files (".noted/", ".obsidian/") stay behind: the destination
 * keeps its own. Empty folders come too.
 */
export async function mergeInto(
  source: VaultStore,
  target: VaultStore,
  folder: string,
  onProgress?: (done: number, total: number) => void,
): Promise<MergeResult> {
  const into = folder ? normalizePath(folder) : "";
  const visible = (p: string) => !p.split("/").some((seg) => seg.startsWith("."));
  const entries = (await source.list()).filter((e) => visible(e.path));
  const files = entries.filter((e) => e.kind === "file").sort((a, b) => a.path.localeCompare(b.path));
  const existing = await target.list();
  const taken = new Set(existing.map((e) => e.path.toLowerCase()));
  const result: MergeResult = { added: 0, skipped: 0, renamed: 0, paths: [] };

  for (const e of entries) if (e.kind === "folder") await target.createFolder(joinPath(into, e.path));

  let done = 0;
  for (const f of files) {
    onProgress?.(done++, files.length);
    const bytes = await bytesOf(source, f.path);
    if (!bytes) continue;
    let dest = joinPath(into, f.path);
    if (taken.has(dest.toLowerCase())) {
      const there = await bytesOf(target, dest);
      if (there && same(there, bytes)) {
        result.skipped++;
        continue;
      }
      dest = uniquePath(dest, (p) => taken.has(p.toLowerCase()));
      result.renamed++;
    } else result.added++;
    taken.add(dest.toLowerCase());
    if (isBinary(dest)) await target.writeBinary(dest, bytes);
    else await target.write(dest, new TextDecoder().decode(bytes));
    result.paths.push(dest);
  }
  onProgress?.(files.length, files.length);
  return result;
}
