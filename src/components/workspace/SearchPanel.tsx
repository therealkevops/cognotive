"use client";

import { useDeferredValue, useMemo } from "react";
import type { NoteHit } from "@/lib/search/note-index";
import { dirname, displayName } from "@/lib/vault/paths";
import { useVault } from "../vault/useVault";
import { Highlighted } from "./Highlighted";

/**
 * Full-text search across every note. "tag:name" or a lone "#name" lists the
 * notes with that tag (including nested tags under it).
 */
export function SearchPanel({
  query,
  onQuery,
  autoFocus,
}: {
  query: string;
  onQuery(q: string): void;
  autoFocus?: boolean;
}) {
  const vault = useVault();
  const deferred = useDeferredValue(query);
  const hits = useMemo<NoteHit[]>(() => {
    const tag = /^\s*(?:tag:\s*#?|#)([^\s#]+)\s*$/i.exec(deferred)?.[1];
    if (tag) {
      return vault.links.withTag(tag).map((path) => ({
        path,
        title: displayName(path),
        snippet: `#${vault.links.get(path)?.tags.filter((t) => t === tag.toLowerCase() || t.startsWith(tag.toLowerCase() + "/")).join(" #")}`,
        matches: [],
        score: 1,
      }));
    }
    return vault.index.search(deferred);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- indexVersion signals index changes
  }, [deferred, vault.index, vault.links, vault.indexVersion]);

  return (
    <section aria-label="Search" className="flex h-full flex-col">
      <input
        type="search"
        autoFocus={autoFocus}
        aria-label="Search all notes"
        placeholder="Search notes, or tag:name…"
        className="mb-2 w-full rounded border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-accent"
        value={query}
        onChange={(e) => onQuery(e.target.value)}
      />
      {deferred.trim() && (
        <p className="mb-1 text-xs text-muted" aria-live="polite">
          {hits.length === 0 ? "No matches" : `${hits.length} ${hits.length === 1 ? "note" : "notes"}`}
        </p>
      )}
      <ul className="-mx-2 flex-1 overflow-y-auto">
        {hits.map((h) => (
          <li key={h.path}>
            <button
              type="button"
              className={`w-full rounded px-2 py-1.5 text-left hover:bg-foreground/5 ${
                vault.active?.path === h.path ? "bg-accent/15" : ""
              }`}
              onClick={() => void vault.open(h.path)}
            >
              <span className="block truncate text-sm font-medium">{h.title}</span>
              {dirname(h.path) && <span className="block truncate text-xs text-muted">{dirname(h.path)}</span>}
              <span className="mt-0.5 line-clamp-2 block text-xs text-muted">
                <Highlighted text={h.snippet} ranges={h.matches} />
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
