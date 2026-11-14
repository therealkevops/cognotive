import MiniSearch, { type SearchResult } from "minisearch";
import { splitFrontmatter } from "../markdown/frontmatter";
import { noteTitle } from "../vault/paths";

export interface NoteHit {
  path: string;
  title: string;
  /** A short excerpt around the first match, or the start of the note. */
  snippet: string;
  /** Character ranges in `snippet` to highlight. */
  matches: Array<[number, number]>;
  score: number;
}

interface Doc {
  id: string;
  title: string;
  text: string;
}

const SNIPPET_RADIUS = 60;

/** Markdown with the syntax noise removed, for indexing and snippets. */
export function plainText(markdown: string): string {
  return splitFrontmatter(markdown)
    .body.replace(/```[^\n]*\n/g, "")
    .replace(/!?\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target, alias) => alias ?? target)
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)/gm, "")
    .replace(/(\*\*|__|==|~~|`)/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();
}

/**
 * Keyword search over the vault's notes. Titles weigh more than body text;
 * matching is prefix-based with light fuzziness, so "proj" finds "Projects".
 */
export class NoteIndex {
  private search_ = new MiniSearch<Doc>({
    fields: ["title", "text"],
    storeFields: ["title", "text"],
    searchOptions: {
      boost: { title: 3 },
      prefix: true,
      fuzzy: (term) => (term.length > 3 ? 0.2 : false),
      combineWith: "AND",
    },
  });

  get size(): number {
    return this.search_.documentCount;
  }

  /** Adds or replaces a note. */
  set(path: string, markdown: string): void {
    this.remove(path);
    this.search_.add({ id: path, title: noteTitle(path), text: plainText(markdown) });
  }

  remove(path: string): void {
    if (this.search_.has(path)) this.search_.discard(path);
  }

  clear(): void {
    this.search_.removeAll();
  }

  search(query: string, limit = 50): NoteHit[] {
    const q = query.trim();
    if (!q) return [];
    return this.search_
      .search(q)
      .slice(0, limit)
      .map((r) => toHit(r));
  }

  /** Title-only search for the quick switcher. */
  searchTitles(query: string, limit = 20): NoteHit[] {
    const q = query.trim();
    if (!q) return [];
    return this.search_
      .search(q, { fields: ["title"], combineWith: "AND" })
      .slice(0, limit)
      .map((r) => toHit(r));
  }
}

function toHit(r: SearchResult): NoteHit {
  const text = r.text as string;
  const terms = r.terms.map((t) => t.toLowerCase());
  const lower = text.toLowerCase();

  let first = -1;
  for (const t of terms) {
    const i = lower.indexOf(t);
    if (i !== -1 && (first === -1 || i < first)) first = i;
  }

  const start = first === -1 ? 0 : Math.max(0, first - SNIPPET_RADIUS);
  const end = Math.min(text.length, (first === -1 ? 0 : first) + SNIPPET_RADIUS * 2);
  let snippet = text.slice(start, end).replace(/\s+/g, " ");
  const prefix = start > 0 ? "…" : "";
  snippet = prefix + snippet + (end < text.length ? "…" : "");

  const matches: Array<[number, number]> = [];
  const lowerSnippet = snippet.toLowerCase();
  for (const t of terms) {
    for (let i = lowerSnippet.indexOf(t); i !== -1; i = lowerSnippet.indexOf(t, i + t.length)) {
      matches.push([i, i + t.length]);
    }
  }
  matches.sort((a, b) => a[0] - b[0]);

  return { path: r.id as string, title: r.title as string, snippet, matches, score: r.score };
}
