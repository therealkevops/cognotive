/** The markdown without a leading "# Title" heading that only repeats the card's title. */
export function withoutTitle(markdown: string, title: string): string {
  const m = /^\s*#[ \t]+(.+?)[ \t#]*(?:\r?\n|$)/.exec(markdown);
  return m && m[1].trim().toLowerCase() === title.trim().toLowerCase() ? markdown.slice(m[0].length) : markdown;
}

/** A text card's first line as plain words, for showing cards by title only. */
export function firstLine(markdown: string): string {
  const line = markdown.split(/\r?\n/).find((l) => l.trim() && !/^\s*(---|```)/.test(l)) ?? "";
  return line
    .replace(/^\s*(#{1,6}\s+|>\s*|[-*+]\s+(\[[ xX]\]\s+)?|\d+[.)]\s+)*/, "")
    .replace(/!?\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/!?\[\[([^\]]+)\]\]/g, "$1")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__|==|~~|`)/g, "")
    .trim();
}

/** A short name for a card: a file's name, a text card's first line, a web page's host. */
export function cardLabel(c: { type: string; [k: string]: unknown }): string {
  if (c.type === "file" && typeof c.file === "string") {
    const name = (c.file.split("/").pop() ?? c.file).replace(/\.(excalidraw\.md|excalidraw|canvas|md)$/i, "");
    const sub = typeof c.subpath === "string" ? c.subpath.replace(/^#\^?/, "") : "";
    return sub ? `${name} › ${sub}` : name;
  }
  if (c.type === "text" && typeof c.text === "string") return firstLine(c.text) || "Empty card";
  if (c.type === "link" && typeof c.url === "string") {
    try {
      return new URL(c.url).hostname;
    } catch {
      return c.url;
    }
  }
  if (c.type === "group") return typeof c.label === "string" && c.label ? c.label : "Group";
  return "";
}
