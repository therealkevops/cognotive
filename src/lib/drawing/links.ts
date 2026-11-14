import { elementLinkTarget } from "./parse";

const WIKILINK = /\[\[([^\]\n]+?)\]\]/;

/**
 * Text elements that mention a note get that note as their element link, as
 * the Obsidian Excalidraw plugin does: writing "See [[Garden]]" in a text box
 * makes the box link to Garden (shown with Excalidraw's link icon, and counted
 * as a backlink). Returns element id → new link, only for elements that change.
 * Links the user set to a web address are left alone.
 */
export function textLinkUpdates(
  elements: ReadonlyArray<{ id: string; type: string; text?: string; link?: string | null; isDeleted?: boolean }>,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const el of elements) {
    if (el.isDeleted || el.type !== "text" || typeof el.text !== "string") continue;
    const m = WIKILINK.exec(el.text);
    if (!m) continue;
    const want = `[[${m[1]}]]`;
    if (el.link === want) continue;
    // Keep a hand-set web link; replace an empty link or an older note link.
    if (el.link && !elementLinkTarget(el.link)) continue;
    if (el.link && !/^\[\[.*\]\]$/.test(el.link.trim())) continue;
    out.set(el.id, want);
  }
  return out;
}

/**
 * If the caret sits inside an unfinished "[[query", returns where the query
 * starts and what has been typed; otherwise null. Stops at a newline, "]" or "|".
 */
export function openWikilink(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const open = before.lastIndexOf("[[");
  if (open === -1) return null;
  const query = before.slice(open + 2);
  if (/[\]\n|]/.test(query)) return null;
  return { start: open + 2, query };
}

/**
 * Text to put in place of the typed query: the link text and the closing
 * brackets, unless they are already right after the caret.
 */
export function completeWikilink(text: string, start: number, caret: number, linkText: string) {
  const closed = text.slice(caret, caret + 2) === "]]";
  const insert = closed ? linkText : `${linkText}]]`;
  return {
    text: text.slice(0, start) + insert + text.slice(caret),
    caret: start + linkText.length + 2,
  };
}

export interface LinkedBox {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** The note the element links to, as written ("Note#Heading|alias" → "Note"). */
  target: string;
}

/** Elements that link to a note, with their scene bounds, for drawing link markers. */
export function linkedBoxes(
  elements: ReadonlyArray<{
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    link?: string | null;
    isDeleted?: boolean;
  }>,
): LinkedBox[] {
  const out: LinkedBox[] = [];
  for (const el of elements) {
    if (el.isDeleted) continue;
    const t = elementLinkTarget(el.link);
    if (!t) continue;
    const target = t.split("|")[0].split("#")[0].trim();
    if (!target) continue;
    // Lines and arrows can have negative sizes; normalise to a box.
    const x = Math.min(el.x, el.x + el.width);
    const y = Math.min(el.y, el.y + el.height);
    out.push({ id: el.id, x, y, width: Math.abs(el.width), height: Math.abs(el.height), target });
  }
  return out;
}

/**
 * The name for a "create new note" suggestion: the typed query, when it is
 * not empty and no existing note already has that title or link text.
 */
export function newNoteName(query: string, notes: ReadonlyArray<{ title: string; linkText: string }>): string | null {
  const q = query.trim();
  if (!q) return null;
  const lower = q.toLowerCase();
  if (notes.some((n) => n.title.toLowerCase() === lower || n.linkText.toLowerCase() === lower)) return null;
  return q;
}
