import type { NoteHit } from "../search/note-index";
import type { SemanticHit } from "./semantic-index";

/** A search result found by words, by meaning, or both. */
export interface HybridHit {
  path: string;
  title: string;
  snippet: string;
  /** Highlight ranges in the snippet (word matches only). */
  matches: Array<[number, number]>;
  via: "words" | "meaning" | "both";
  /** Where the best passage starts in the note (meaning matches). */
  from?: number;
  heading?: string;
}

const K = 60;

/**
 * Merges keyword and meaning results by reciprocal rank fusion: each list
 * gives 1/(K + rank), so a note near the top of either list ranks well, and
 * one found both ways ranks best.
 */
export function fuseResults(words: NoteHit[], meaning: SemanticHit[], title: (path: string) => string, limit = 50): HybridHit[] {
  const score = new Map<string, number>();
  const out = new Map<string, HybridHit>();
  words.forEach((h, i) => {
    score.set(h.path, (score.get(h.path) ?? 0) + 1 / (K + i));
    out.set(h.path, { path: h.path, title: h.title, snippet: h.snippet, matches: h.matches, via: "words" });
  });
  meaning.forEach((h, i) => {
    score.set(h.path, (score.get(h.path) ?? 0) + 1 / (K + i));
    const w = out.get(h.path);
    if (w) out.set(h.path, { ...w, via: "both", from: h.from, ...(h.heading ? { heading: h.heading } : {}) });
    else
      out.set(h.path, {
        path: h.path,
        title: title(h.path),
        snippet: h.preview.replace(/\s+/g, " "),
        matches: [],
        via: "meaning",
        from: h.from,
        ...(h.heading ? { heading: h.heading } : {}),
      });
  });
  return [...out.values()].sort((a, b) => score.get(b.path)! - score.get(a.path)!).slice(0, limit);
}
