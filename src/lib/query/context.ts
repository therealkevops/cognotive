import type { LinkIndex } from "../links/link-index";
import type { NoteIndex } from "../search/note-index";
import { displayName, isNote } from "../vault/paths";
import type { QueryContext } from "./query";

/** What queries read, from the repository's indexes. */
export function queryContext(o: {
  links: LinkIndex;
  search: NoteIndex;
  mtime(path: string): number | undefined;
  linkFor(path: string): string;
  today: string;
  self?: string;
}): QueryContext {
  const inbound = new Map<string, string[]>();
  let built = false;
  const buildInbound = () => {
    if (built) return;
    built = true;
    for (const p of o.links.paths()) {
      for (const out of o.links.outgoing(p)) {
        if (!out.resolved || out.resolved === p) continue;
        const list = inbound.get(out.resolved) ?? [];
        if (!list.includes(p)) list.push(p);
        inbound.set(out.resolved, list);
      }
    }
  };
  return {
    notes: () => o.links.paths().filter(isNote),
    content: (p) => o.links.content(p),
    properties: (p) => o.links.get(p)?.properties ?? {},
    tags: (p) => o.links.get(p)?.tags ?? [],
    outlinks: (p) => [...new Set(o.links.outgoing(p).flatMap((x) => (x.resolved ? [x.resolved] : [])))],
    inlinks: (p) => {
      buildInbound();
      return inbound.get(p) ?? [];
    },
    mtime: o.mtime,
    search: (words) => new Set(o.search.search(words, 10_000).map((h) => h.path)),
    resolve: (t) => o.links.resolve(t),
    linkFor: o.linkFor,
    name: displayName,
    today: o.today,
    ...(o.self ? { self: o.self } : {}),
  };
}

/** Remembers query results until it's replaced (the app makes a new one when any note changes). */
export function queryCacheFor(): (key: string, compute: () => string) => string {
  const cache = new Map<string, string>();
  return (key, compute) => {
    let v = cache.get(key);
    if (v === undefined) cache.set(key, (v = compute()));
    return v;
  };
}
