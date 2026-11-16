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
  /** Totals for the checked notes. */
  stats: {
    notes: number;
    /** Links between two different existing notes (each pair once). */
    links: number;
    /** Notes with at least one link in or out. */
    connected: number;
    /** References to notes that don't exist (every use counts). */
    brokenRefs: number;
  };
  /** 0–100: how well connected the repository is (see `healthScore`). */
  score: number;
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

  const linked = new Set<string>();
  let links = 0;
  for (const p of notes) {
    const targets = new Set(index.outgoing(p).map((o) => o.resolved).filter((t): t is string => !!t && t !== p && isNote(t)));
    links += targets.size;
    if (targets.size > 0) linked.add(p);
    for (const t of targets) linked.add(t);
  }
  const brokenList = [...broken.values()];
  const stats = {
    notes: notes.length,
    links,
    connected: notes.filter((p) => linked.has(p)).length,
    brokenRefs: brokenList.reduce((n, b) => n + b.sources.length, 0),
  };

  return {
    stats,
    score: healthScore({ ...stats, orphans: orphans.length, deadEnds: deadEnds.length, stale: stale.length }),
    orphans,
    deadEnds,
    broken: brokenList.sort((a, b) => b.sources.length - a.sources.length || a.target.localeCompare(b.target)),
    hubs,
    stale,
  };
}

/**
 * A 0–100 score: each problem costs a share of the notes it affects. Broken
 * links weigh most, then orphans and dead ends, then stale hubs. An empty
 * repository scores 100.
 */
export function healthScore(c: { notes: number; brokenRefs: number; orphans: number; deadEnds: number; stale: number }): number {
  if (c.notes === 0) return 100;
  const rate = (n: number) => Math.min(1, n / c.notes);
  const penalty = 0.35 * rate(c.brokenRefs) + 0.3 * rate(c.orphans) + 0.25 * rate(c.deadEnds) + 0.1 * rate(c.stale);
  return Math.max(0, Math.min(100, Math.round(100 * (1 - penalty))));
}

/** A word for a score, and a tone for its colour. */
export function scoreVerdict(score: number): { label: string; tone: "good" | "fair" | "poor" | "bad" } {
  if (score >= 85) return { label: "Well connected", tone: "good" };
  if (score >= 65) return { label: "A few loose ends", tone: "fair" };
  if (score >= 40) return { label: "Needs some tending", tone: "poor" };
  return { label: "Mostly scattered", tone: "bad" };
}

/**
 * Files last changed on each of the past `weeks` weeks' days, oldest first,
 * as weeks of 7 days (Sunday first) ending with the week containing `now`.
 * Days after `now` are null.
 */
export function activityWeeks(mtimes: number[], opts: { now?: number; weeks?: number } = {}): Array<Array<{ day: number; count: number } | null>> {
  const now = new Date(opts.now ?? Date.now());
  const weeks = opts.weeks ?? 26;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const start = new Date(today);
  start.setDate(start.getDate() - today.getDay() - (weeks - 1) * 7);
  const key = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  const counts = new Map<string, number>();
  for (const t of mtimes) {
    const k = key(new Date(t));
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const out: Array<Array<{ day: number; count: number } | null>> = [];
  const d = new Date(start);
  for (let w = 0; w < weeks; w++) {
    const week: Array<{ day: number; count: number } | null> = [];
    for (let i = 0; i < 7; i++) {
      week.push(d > today ? null : { day: d.getTime(), count: counts.get(key(d)) ?? 0 });
      d.setDate(d.getDate() + 1);
    }
    out.push(week);
  }
  return out;
}
