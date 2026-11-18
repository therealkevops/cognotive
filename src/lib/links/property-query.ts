import type { LinkIndex } from "./link-index";

/**
 * Searching by property, as in Obsidian: "[status]" finds files that have the
 * property, "[status:draft]" those whose value contains "draft" (any item of
 * a list), and words outside brackets are searched as usual.
 */
export interface PropertyQuery {
  terms: Array<{ key: string; value?: string }>;
  /** The rest of the query: ordinary search words. */
  text: string;
}

export function parsePropertyQuery(query: string): PropertyQuery | null {
  const terms: PropertyQuery["terms"] = [];
  const text = query.replace(/\[\s*([^\]:]+?)\s*(?::\s*([^\]]*?)\s*)?\]/g, (_, key: string, value?: string) => {
    terms.push(value ? { key, value } : { key });
    return " ";
  });
  return terms.length ? { terms, text: text.replace(/\s+/g, " ").trim() } : null;
}

/** A value as text, for matching and showing. */
export function valueText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) return v.map(valueText).join(", ");
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function matches(props: Record<string, unknown>, term: { key: string; value?: string }): boolean {
  const key = Object.keys(props).find((k) => k.toLowerCase() === term.key.toLowerCase());
  if (key === undefined) return false;
  if (term.value === undefined) return true;
  const want = term.value.toLowerCase();
  const v = props[key];
  const items = Array.isArray(v) ? v : [v];
  return items.some((i) => valueText(i).toLowerCase().includes(want));
}

/** Files whose properties match every term, sorted by path. */
export function filesWithProperties(index: LinkIndex, terms: PropertyQuery["terms"]): string[] {
  return index
    .paths()
    .filter((p) => {
      const props = index.get(p)?.properties ?? {};
      return terms.every((t) => matches(props, t));
    })
    .sort();
}
