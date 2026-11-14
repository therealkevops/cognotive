/** A linkable block of a note: a paragraph, list item or quote. */
export interface Block {
  /** Offsets of the block in the note; `to` is the end of its last line (before any "^id"). */
  from: number;
  to: number;
  /** Short plain text, for suggestions. */
  text: string;
  /** Its block id, if it already has one ("text ^id"). */
  id?: string;
}

const LIST_ITEM = /^\s*([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?/;
const ID_AT_END = /\s\^([A-Za-z0-9-]+)\s*$/;

function preview(lines: string[]): string {
  const text = lines
    .map((l) => l.replace(ID_AT_END, "").replace(LIST_ITEM, "").replace(/^\s*>\s?/, ""))
    .join(" ")
    .replace(/[*_~`=]+/g, "")
    .replace(/!?\[\[([^\]|]*\|)?([^\]]+)\]\]/g, "$2")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > 90 ? `${text.slice(0, 89)}…` : text;
}

/**
 * The blocks of a note, in order: paragraphs, single list items and
 * blockquotes. Skips front matter, headings, code fences, tables and
 * lines that are only a block id.
 */
export function listBlocks(markdown: string): Block[] {
  const lines = markdown.split("\n");
  const starts: number[] = [];
  let off = 0;
  for (const l of lines) {
    starts.push(off);
    off += l.length + 1;
  }
  const out: Block[] = [];
  let i = 0;
  if (lines[0]?.trim() === "---") {
    const end = lines.findIndex((l, n) => n > 0 && (l.trim() === "---" || l.trim() === "..."));
    if (end !== -1) i = end + 1;
  }
  const push = (a: number, b: number) => {
    const block = lines.slice(a, b + 1);
    const text = preview(block);
    if (!text) return;
    const id = ID_AT_END.exec(lines[b])?.[1];
    const to = starts[b] + lines[b].replace(ID_AT_END, "").length;
    out.push({ from: starts[a], to, text, ...(id ? { id } : {}) });
  };
  const blank = (l: string) => l.trim() === "";
  const special = (l: string) => /^\s{0,3}(#{1,6}\s|```|~~~|\|)/.test(l) || /^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(l);
  while (i < lines.length) {
    const l = lines[i];
    if (blank(l)) {
      i++;
    } else if (/^\s{0,3}(```|~~~)/.test(l)) {
      const fence = l.trim().slice(0, 3);
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence)) i++;
      i++;
    } else if (special(l)) {
      i++;
    } else if (LIST_ITEM.test(l)) {
      // An item and its wrapped (more indented, non-item) continuation lines.
      let j = i;
      while (j + 1 < lines.length && !blank(lines[j + 1]) && !LIST_ITEM.test(lines[j + 1]) && /^\s+/.test(lines[j + 1])) j++;
      push(i, j);
      i = j + 1;
    } else if (/^\s*>/.test(l)) {
      let j = i;
      while (j + 1 < lines.length && /^\s*>/.test(lines[j + 1])) j++;
      push(i, j);
      i = j + 1;
    } else if (/^\s*\^[A-Za-z0-9-]+\s*$/.test(l)) {
      i++;
    } else {
      let j = i;
      while (j + 1 < lines.length && !blank(lines[j + 1]) && !special(lines[j + 1]) && !LIST_ITEM.test(lines[j + 1])) j++;
      push(i, j);
      i = j + 1;
    }
  }
  return out;
}

/** A short random block id not already in `taken`, like Obsidian's ("a1b2c3"). */
export function newBlockId(taken: Set<string>): string {
  for (;;) {
    const id = Math.random().toString(36).slice(2, 8);
    if (id.length === 6 && !taken.has(id)) return id;
  }
}

/** Every block id used in a note. */
export function blockIds(markdown: string): Set<string> {
  return new Set([...markdown.matchAll(/\s\^([A-Za-z0-9-]+)\s*$/gm)].map((m) => m[1]));
}

/** The change that gives `block` the id `id`: " ^id" at the end of its last line. */
export function blockIdChange(block: Block, id: string): { from: number; insert: string } {
  return { from: block.to, insert: ` ^${id}` };
}
