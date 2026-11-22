"use client";

import { Sparkles } from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { fuseResults, type HybridHit } from "@/lib/semantic/hybrid";
import type { SemanticHit } from "@/lib/semantic/semantic-index";
import { useSemantic } from "../semantic/useSemantic";
import { statusText } from "../semantic/SemanticSettings";
import { filesWithProperties, parsePropertyQuery, valueText } from "@/lib/links/property-query";
import type { NoteHit } from "@/lib/search/note-index";
import { dirname, displayName } from "@/lib/vault/paths";
import { useVault } from "../vault/useVault";
import { Highlighted } from "./Highlighted";

/**
 * Full-text search across every note. "tag:name" or a lone "#name" lists the
 * notes with that tag (including nested tags under it). "[key]" and
 * "[key:value]" find files by property, alone or with search words.
 */
export function SearchPanel({
  query,
  onQuery,
  autoFocus,
  onEditProperties,
  onOpenAt,
  onSearchSettings,
}: {
  query: string;
  onQuery(q: string): void;
  autoFocus?: boolean;
  /** Opens the results' properties as a table. */
  onEditProperties?(paths: string[]): void;
  /** Opens a note at a passage (a match by meaning). */
  onOpenAt?(path: string, offset: number): void;
  /** Opens Settings → Search. */
  onSearchSettings?(): void;
}) {
  const vault = useVault();
  const semantic = useSemantic();
  const deferred = useDeferredValue(query);
  // Plain words (not tag: or [property] searches) are also searched by meaning.
  const plain = !/^\s*(?:tag:|#)/i.test(deferred) && !parsePropertyQuery(deferred) && deferred.trim().length > 1;
  const [byMeaning, setByMeaning] = useState<{ query: string; hits: SemanticHit[] }>({ query: "", hits: [] });
  const { enabled: meaningOn, search: searchMeaning, version: meaningVersion } = semantic;
  useEffect(() => {
    if (!meaningOn || !plain) return;
    let live = true;
    const q = deferred;
    void searchMeaning(q, 20).then((hits) => live && setByMeaning({ query: q, hits }));
    return () => {
      live = false;
    };
    // meaningVersion: search again once indexing catches up.
  }, [deferred, plain, meaningOn, searchMeaning, meaningVersion]);
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
    const byProperty = parsePropertyQuery(deferred);
    if (byProperty) {
      const found = filesWithProperties(vault.links, byProperty.terms);
      const describe = (path: string) => {
        const props = vault.links.get(path)?.properties ?? {};
        return byProperty.terms
          .map((t) => {
            const key = Object.keys(props).find((k) => k.toLowerCase() === t.key.toLowerCase()) ?? t.key;
            return `${key}: ${valueText(props[key])}`;
          })
          .join(" · ");
      };
      if (!byProperty.text) {
        return found.map((path) => ({ path, title: displayName(path), snippet: describe(path), matches: [], score: 1 }));
      }
      const allowed = new Set(found);
      return vault.index.search(byProperty.text).filter((h) => allowed.has(h.path));
    }
    return vault.index.search(deferred);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- indexVersion signals index changes
  }, [deferred, vault.index, vault.links, vault.indexVersion]);
  const results: Array<NoteHit | HybridHit> = useMemo(
    () =>
      semantic.enabled && plain && byMeaning.query === deferred && byMeaning.hits.length
        ? fuseResults(hits, byMeaning.hits, displayName)
        : hits,
    [hits, byMeaning, deferred, plain, semantic.enabled],
  );
  const indexing = semantic.enabled && (semantic.status.state === "indexing" || semantic.status.state === "downloading" || semantic.status.state === "starting");

  return (
    <section aria-label="Search" className="flex h-full flex-col">
      <input
        type="search"
        autoFocus={autoFocus}
        aria-label="Search all notes"
        placeholder="Search notes, tag:name or [property:value]…"
        className="mb-2 w-full rounded border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-accent"
        value={query}
        onChange={(e) => onQuery(e.target.value)}
      />
      {deferred.trim() && (
        <div className="mb-1 flex items-center gap-2 text-xs text-muted">
          <p className="flex-1" aria-live="polite">
            {results.length === 0 ? "No matches" : `${results.length} ${results.length === 1 ? "note" : "notes"}`}
          </p>
          {onEditProperties && results.length > 0 && (
            <button
              type="button"
              className="rounded px-1.5 py-0.5 hover:bg-foreground/5 hover:text-accent"
              title="Edit the properties of these files as a table"
              onClick={() => onEditProperties(results.map((h) => h.path))}
            >
              Edit properties
            </button>
          )}
        </div>
      )}
      <ul className="-mx-2 flex-1 overflow-y-auto">
        {results.map((h) => {
          const meaningOnly = "via" in h && h.via === "meaning";
          return (
          <li key={h.path}>
            <button
              type="button"
              className={`w-full rounded px-2 py-1.5 text-left hover:bg-foreground/5 ${
                vault.active?.path === h.path ? "bg-accent/15" : ""
              }`}
              onClick={() => ("from" in h && h.from !== undefined && meaningOnly && onOpenAt ? onOpenAt(h.path, h.from) : void vault.open(h.path))}
            >
              <span className="flex items-center gap-1.5">
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{h.title}</span>
                {meaningOnly && (
                  <span className="flex shrink-0 items-center gap-0.5 text-[11px] text-muted" title="Found by meaning: different words, similar content">
                    <Sparkles size={10} aria-hidden /> by meaning
                  </span>
                )}
              </span>
              {dirname(h.path) && <span className="block truncate text-xs text-muted">{dirname(h.path)}</span>}
              <span className="mt-0.5 line-clamp-2 block text-xs text-muted">
                {meaningOnly && "heading" in h && h.heading && h.heading !== h.title ? `${h.heading}: ` : ""}
                <Highlighted text={h.snippet} ranges={h.matches} />
              </span>
            </button>
          </li>
          );
        })}
      </ul>
      {indexing && (
        <p className="mt-1 text-xs text-muted" role="status">
          {statusText(semantic.status)}
        </p>
      )}
      {!semantic.enabled && plain && onSearchSettings && (
        <p className="mt-1 text-xs text-muted">
          Search by meaning finds notes in other words.{" "}
          <button type="button" className="text-accent hover:underline" onClick={onSearchSettings}>
            Turn it on
          </button>
        </p>
      )}
    </section>
  );
}
