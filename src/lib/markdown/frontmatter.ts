const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/;

/** Splits YAML frontmatter ("---" fenced block at the very top) from the body. */
export function splitFrontmatter(markdown: string): { frontmatter: string; body: string } {
  const m = FRONTMATTER.exec(markdown);
  return m
    ? { frontmatter: m[0], body: markdown.slice(m[0].length) }
    : { frontmatter: "", body: markdown };
}

/**
 * Sets a simple property (`key: value`) in a note's frontmatter, adding the
 * frontmatter if there is none; `undefined` removes the property (and an
 * empty frontmatter block with it). Other lines are left exactly as they are.
 */
export function setFrontmatterProperty(markdown: string, key: string, value: string | boolean | undefined): string {
  const { frontmatter, body } = splitFrontmatter(markdown);
  const line = value === undefined ? null : `${key}: ${value}`;
  const own = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:.*$`);
  if (!frontmatter) return line === null ? markdown : `---\n${line}\n---\n${markdown}`;
  const nl = frontmatter.includes("\r\n") ? "\r\n" : "\n";
  const lines = frontmatter.replace(/\r?\n$/, "").split(/\r?\n/);
  const inner = lines.slice(1, -1);
  const at = inner.findIndex((l) => own.test(l));
  if (at === -1) {
    if (line !== null) inner.push(line);
  } else {
    // Drop the property's own line and any indented lines under it (a list value).
    let end = at + 1;
    while (end < inner.length && /^\s+\S|^\s*-\s/.test(inner[end])) end++;
    inner.splice(at, end - at, ...(line === null ? [] : [line]));
  }
  if (inner.every((l) => !l.trim())) return body;
  return ["---", ...inner, "---"].join(nl) + nl + body;
}
