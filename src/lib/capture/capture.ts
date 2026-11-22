/**
 * Quick capture: a thought, a link, a passage or a picture, added to today's
 * daily note (or an inbox note) under a "Captured" heading, one list item each
 * with the time it was captured.
 */
export const CAPTURE_HEADING = "Captured";

export interface Captured {
  /** What was typed or shared as text. */
  text: string;
  /** A shared page. */
  url?: string;
  title?: string;
  /** Embeds for saved attachments, already written as links (e.g. "![[photo.jpg]]"). */
  embeds?: string[];
}

/** What a share sheet sends, tidied: Android often puts the link in the text, or the title in the text. */
export function fromShare(share: { title?: string | null; text?: string | null; url?: string | null }): Captured {
  let url = share.url?.trim() || undefined;
  let text = share.text?.trim() ?? "";
  // A link shared as text (as many apps do).
  const found = /https?:\/\/\S+/.exec(text);
  if (!url && found) url = found[0].replace(/[).,]+$/, "");
  if (url) text = text.replace(url, "").trim();
  let title = share.title?.trim() || undefined;
  if (title && text === title) text = "";
  if (!url && title && !text) {
    text = title;
    title = undefined;
  }
  return { text, ...(url ? { url } : {}), ...(url && title ? { title } : {}) };
}

/** "14:05" */
export function captureTime(d = new Date()): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

const escapeLabel = (s: string) => s.replace(/[[\]]/g, "\\$&");

/** One captured item as a list item: the time, the link, the text, and any pictures under it. */
export function captureEntry(c: Captured, time: string): string {
  const lines = c.text.replace(/\r\n?/g, "\n").trim().split("\n");
  const link = c.url ? `[${escapeLabel(c.title || c.url)}](${c.url.replace(/[ )]/g, encodeURIComponent)})` : "";
  const [first, ...rest] = lines;
  const head = [time, link, first].filter(Boolean).join(" ");
  const body = [...rest.map((l) => (l.trim() ? `  ${l}` : "")), ...(c.embeds ?? []).map((e) => `  ${e}`)];
  return [`- ${head}`, ...body].join("\n").replace(/\n{3,}/g, "\n\n");
}

/** The note with the entry added at the end of its "Captured" section (made at the end if missing). */
export function appendCapture(content: string, entry: string): string {
  const lines = content.split("\n");
  const start = lines.findIndex((l) => new RegExp(`^\\s{0,3}#{1,6}\\s+${CAPTURE_HEADING}\\s*#*\\s*$`, "i").test(l));
  if (start === -1) {
    const body = content.replace(/\s+$/, "");
    return `${body}${body ? "\n\n" : ""}## ${CAPTURE_HEADING}\n\n${entry}\n`;
  }
  const level = /^\s{0,3}(#{1,6})/.exec(lines[start])![1].length;
  let end = start + 1;
  while (end < lines.length) {
    const h = /^\s{0,3}(#{1,6})\s/.exec(lines[end]);
    if (h && h[1].length <= level) break;
    end++;
  }
  let at = end;
  while (at > start + 1 && !lines[at - 1].trim()) at--;
  // Straight after an earlier list item, so the captures stay one list; after anything else, a blank line first.
  const afterItem = at > start + 1 && /^(\s*[-*+] |\s{2,}\S)/.test(lines[at - 1]);
  const insert = [...(afterItem || at === start + 1 ? [] : [""]), ...(at === start + 1 ? [""] : []), ...entry.split("\n")];
  if (at < lines.length && lines[at].trim()) insert.push("");
  lines.splice(at, 0, ...insert);
  const out = lines.join("\n");
  return at >= lines.length - insert.length && !out.endsWith("\n") ? out + "\n" : out;
}

export function isEmpty(c: Captured): boolean {
  return !c.text.trim() && !c.url && !c.embeds?.length;
}
