/** The markdown without a leading "# Title" heading that only repeats the card's title. */
export function withoutTitle(markdown: string, title: string): string {
  const m = /^\s*#[ \t]+(.+?)[ \t#]*(?:\r?\n|$)/.exec(markdown);
  return m && m[1].trim().toLowerCase() === title.trim().toLowerCase() ? markdown.slice(m[0].length) : markdown;
}
