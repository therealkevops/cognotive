/*
 * A line of a note shown as a snippet in the Connections panel: its markdown taken out
 * (list markers, headings, emphasis, code ticks), with links reduced to the words they show
 * and marked, so they can stand out from the text around them.
 */

export interface Segment {
  text: string;
  /** A link: its shown text. */
  link?: boolean;
  /** The words a mention is about. */
  mark?: boolean;
}

const LINK = /!?\[\[([^\]|#^]*)(?:[#^]([^\]|]*))?(?:\|([^\]]*))?\]\]|!?\[([^\]]*)\]\([^)]*\)/g;

/** Emphasis, highlight, strikethrough and code marks taken out of plain text. */
function plain(s: string): string {
  return s
    .replace(/(\*\*|__|==|~~|`)/g, "")
    .replace(/(^|[\s(])[*_](\S(?:[^*_]*\S)?)[*_](?=[\s).,;:!?]|$)/g, "$1$2");
}

/** Text with its links reduced to their words (no code spans in it). */
function withLinks(text: string, out: Segment[]): void {
  let at = 0;
  for (const m of text.matchAll(LINK)) {
    if (m.index! > at) out.push({ text: plain(text.slice(at, m.index)) });
    const [, target, sub, alias, mdText] = m;
    const shown =
      mdText !== undefined ? mdText : alias?.trim() || [target?.trim(), sub?.trim()].filter(Boolean).join(" › ");
    if (shown) out.push({ text: shown, link: true });
    at = m.index! + m[0].length;
  }
  if (at < text.length) out.push({ text: plain(text.slice(at)) });
}

export function snippet(line: string): Segment[] {
  const body = line.trim().replace(/^(#{1,6}\s+|>\s*|[-*+]\s+(\[[ xX]\]\s+)?|\d+[.)]\s+)+/, "");
  const out: Segment[] = [];
  // Code spans are shown as they are (without their ticks): "[[" in one isn't a link.
  let at = 0;
  for (const m of body.matchAll(/(`+)([^`]|[^`].*?[^`])\1(?!`)/g)) {
    withLinks(body.slice(at, m.index), out);
    out.push({ text: m[2].trim() });
    at = m.index! + m[0].length;
  }
  withLinks(body.slice(at), out);
  // Neighbouring plain pieces as one.
  const merged: Segment[] = [];
  for (const seg of out) {
    if (!seg.text) continue;
    const last = merged[merged.length - 1];
    if (last && !last.link && !last.mark && !seg.link) last.text += seg.text;
    else merged.push({ ...seg });
  }
  return merged;
}

/** The snippet with the first appearance of `words` (outside links) marked. */
export function markWords(segments: Segment[], words: string): Segment[] {
  const want = words.trim().toLowerCase();
  if (!want) return segments;
  let done = false;
  return segments.flatMap((s) => {
    if (done || s.link) return [s];
    const i = s.text.toLowerCase().indexOf(want);
    if (i < 0) return [s];
    done = true;
    return [
      { text: s.text.slice(0, i) },
      { text: s.text.slice(i, i + want.length), mark: true },
      { text: s.text.slice(i + want.length) },
    ].filter((x) => x.text);
  });
}
