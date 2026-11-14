import { splitFrontmatter } from "./frontmatter";

export interface Heading {
  level: number;
  text: string;
  /** Character offset of the heading line in the full note (including frontmatter). */
  offset: number;
}

/** ATX headings ("# Title"), skipping fenced code blocks. */
export function extractHeadings(markdown: string): Heading[] {
  const { frontmatter, body } = splitFrontmatter(markdown);
  const headings: Heading[] = [];
  let offset = frontmatter.length;
  let fence: string | null = null;
  for (const line of body.split("\n")) {
    const f = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (f) {
      if (!fence) fence = f[1][0];
      else if (f[1][0] === fence) fence = null;
    } else if (!fence) {
      const m = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
      if (m && m[2]) headings.push({ level: m[1].length, text: m[2], offset });
    }
    offset += line.length + 1;
  }
  return headings;
}
