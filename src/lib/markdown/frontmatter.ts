const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/;

/** Splits YAML frontmatter ("---" fenced block at the very top) from the body. */
export function splitFrontmatter(markdown: string): { frontmatter: string; body: string } {
  const m = FRONTMATTER.exec(markdown);
  return m
    ? { frontmatter: m[0], body: markdown.slice(m[0].length) }
    : { frontmatter: "", body: markdown };
}
