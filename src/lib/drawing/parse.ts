import { splitLinkText, type ParsedLink } from "../links/parse";

/** A new, empty drawing file. */
export const EMPTY_DRAWING = JSON.stringify(
  {
    type: "excalidraw",
    version: 2,
    source: "noted-ai",
    elements: [],
    appState: { gridSize: null, viewBackgroundColor: "#ffffff" },
    files: {},
  },
  null,
  2,
);

interface DrawingElement {
  id?: string;
  type?: string;
  text?: string;
  link?: string | null;
  isDeleted?: boolean;
}

interface DrawingFile {
  elements?: DrawingElement[];
}

function load(json: string): DrawingFile | null {
  try {
    const d = JSON.parse(json) as unknown;
    return d && typeof d === "object" ? (d as DrawingFile) : null;
  } catch {
    return null;
  }
}

const WIKILINK = /\[\[([^\]\n]+?)\]\]/g;

/**
 * Turns an element's link into a link target, if it points at a note:
 * "[[Note]]" (as the Obsidian Excalidraw plugin writes it) or a bare vault path.
 * URLs and in-drawing element links aren't note links.
 */
export function elementLinkTarget(link: string | null | undefined): string | null {
  if (!link) return null;
  const t = link.trim();
  const wiki = /^\[\[([^\]\n]+?)\]\]$/.exec(t);
  if (wiki) return wiki[1];
  if (/^[a-z][a-z0-9+.-]*:/i.test(t) || t.startsWith("#") || t.startsWith("//")) return null;
  return t;
}

/** Text and note links in a drawing, for search and the link graph. */
export function parseDrawing(json: string): { text: string; links: ParsedLink[] } {
  const d = load(json);
  const texts: string[] = [];
  const links: ParsedLink[] = [];
  const add = (inner: string) =>
    links.push({ ...splitLinkText(inner), embed: false, kind: "wikilink", from: 0, to: 0, line: 0 });
  for (const el of d?.elements ?? []) {
    if (el.isDeleted) continue;
    if (typeof el.text === "string" && el.text.trim()) {
      texts.push(el.text);
      for (const m of el.text.matchAll(WIKILINK)) add(m[1]);
    }
    const target = elementLinkTarget(el.link);
    if (target) add(target);
  }
  return { text: texts.join("\n"), links };
}

/**
 * Rewrites note links inside a drawing (element links and [[links]] in text)
 * whose target `shouldRewrite` accepts, to point at `newText`. Returns null if
 * nothing changed. Keeps headings and aliases.
 */
export function rewriteDrawingLinks(
  json: string,
  shouldRewrite: (target: string) => boolean,
  newText: string,
): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  const d = parsed as DrawingFile;
  let changed = false;
  const retarget = (inner: string) => {
    const p = splitLinkText(inner);
    if (!p.target || !shouldRewrite(p.target)) return null;
    changed = true;
    const sub = p.block ? `#^${p.block}` : p.heading ? `#${p.heading}` : "";
    return `${newText}${sub}${p.alias ? `|${p.alias}` : ""}`;
  };
  for (const el of d.elements ?? []) {
    if (typeof el.text === "string") {
      el.text = el.text.replace(WIKILINK, (all, inner: string) => {
        const t = retarget(inner);
        return t ? `[[${t}]]` : all;
      });
      const raw = el as DrawingElement & { originalText?: string };
      if (typeof raw.originalText === "string") {
        raw.originalText = raw.originalText.replace(WIKILINK, (all, inner: string) => {
          const t = retarget(inner);
          return t ? `[[${t}]]` : all;
        });
      }
    }
    const target = elementLinkTarget(el.link);
    if (target) {
      const t = retarget(target);
      if (t) el.link = `[[${t}]]`;
    }
  }
  return changed ? JSON.stringify(parsed, null, 2) : null;
}
