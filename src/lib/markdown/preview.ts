import { sectionUnder } from "./remark-links";

/** Longest preview rendered in a hover card; the card scrolls, but huge notes would be slow. */
const MAX_PREVIEW = 6000;

/**
 * The paragraph or list item that ends in the block id `^id`, without the
 * id itself; null if the note has no such block.
 */
export function blockUnder(markdown: string, id: string): string | null {
  const lines = markdown.split("\n");
  const marker = new RegExp(`\\s\\^${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`);
  const at = lines.findIndex((l) => marker.test(l));
  if (at === -1) return null;
  const strip = (l: string) => l.replace(marker, "");
  // A list item is its own block; otherwise take the paragraph back to the last blank line.
  if (/^\s*([-*+]|\d+[.)])\s/.test(lines[at])) return strip(lines[at]);
  let start = at;
  const boundary = (l: string) => l.trim() === "" || /^\s*([-*+]|\d+[.)])\s/.test(l) || /^\s{0,3}#{1,6}\s/.test(l);
  while (start > 0 && !boundary(lines[start - 1])) start--;
  return [...lines.slice(start, at), strip(lines[at])].join("\n");
}

/**
 * The markdown to show when hovering a link: the whole note, the section
 * under a heading, or a block ("^id"). Long notes are cut at a line break.
 */
export function previewMarkdown(body: string, sub?: string): string {
  let md = body;
  if (sub?.startsWith("^")) md = blockUnder(body, sub.slice(1)) ?? "";
  else if (sub) md = sectionUnder(body, sub) ?? "";
  if (md.length > MAX_PREVIEW) {
    const cut = md.lastIndexOf("\n", MAX_PREVIEW);
    md = `${md.slice(0, cut > 0 ? cut : MAX_PREVIEW)}\n\n…`;
  }
  return md;
}
