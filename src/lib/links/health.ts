import { isNote } from "../vault/paths";
import type { LinkIndex } from "./link-index";

export interface VaultHealth {
  /** Notes nothing links to. */
  orphans: string[];
  /** Notes that don't link anywhere. */
  deadEnds: string[];
  /** Links to notes that don't exist: target → notes using it. */
  broken: Array<{ target: string; sources: string[] }>;
  /** The most linked-to notes. */
  hubs: Array<{ path: string; links: number }>;
  /** Notes many others rely on that haven't been touched in a long time. */
  stale: Array<{ path: string; links: number; mtime: number }>;
}

const DAY = 86_400_000;

/**
 * What the link graph says needs attention, as lists you can act on.
 * `ignore` skips notes that are naturally unlinked (daily notes, templates).
 */
export function vaultHealth(
  index: LinkIndex,
  opts: { mtime(path: string): number | undefined; now?: number; ignore?(path: string): boolean; staleDays?: number },
): VaultHealth {
  const now = opts.now ?? Date.now();
  const ignore = opts.ignore ?? (() => false);
  const notes = index.paths().filter((p) => isNote(p) && !ignore(p));
  const inbound = index.inboundCounts();

  const orphans = notes.filter((p) => !inbound.has(p)).sort();
  const deadEnds = notes.filter((p) => !index.outgoing(p).some((o) => o.resolved && o.resolved !== p)).sort();

  const broken = new Map<string, { target: string; sources: string[] }>();
  for (const [target, sources] of index.unresolved()) {
    const key = target.toLowerCase();
    const g = broken.get(key) ?? { target, sources: [] };
    for (const s of sources) if (!g.sources.includes(s)) g.sources.push(s);
    broken.set(key, g);
  }

  const hubs = [...inbound]
    .filter(([p, n]) => isNote(p) && n >= 2)
    .map(([path, links]) => ({ path, links }))
    .sort((a, b) => b.links - a.links || a.path.localeCompare(b.path))
    .slice(0, 10);

  const cutoff = now - (opts.staleDays ?? 180) * DAY;
  const stale = notes
    .map((path) => ({ path, links: inbound.get(path) ?? 0, mtime: opts.mtime(path) ?? now }))
    .filter((n) => n.links >= 3 && n.mtime < cutoff)
    .sort((a, b) => a.mtime - b.mtime);

  return {
    orphans,
    deadEnds,
    broken: [...broken.values()].sort((a, b) => b.sources.length - a.sources.length || a.target.localeCompare(b.target)),
    hubs,
    stale,
  };
}
