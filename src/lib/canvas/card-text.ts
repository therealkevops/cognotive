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
