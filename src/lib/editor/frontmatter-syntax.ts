import { tags } from "@lezer/highlight";
import type { MarkdownConfig } from "@lezer/markdown";

/**
 * Lezer extension: a YAML block fenced by "---" lines at the very top of the
 * note is Frontmatter, not a horizontal rule followed by a setext heading.
 */
export const FrontmatterSyntax: MarkdownConfig = {
  defineNodes: [{ name: "Frontmatter", block: true, style: tags.meta }],
  parseBlock: [
    {
      name: "Frontmatter",
      parse(cx, line) {
        if (cx.lineStart !== 0 || !/^---\s*$/.test(line.text)) return false;
        const start = cx.lineStart;
        let end = -1;
        while (cx.nextLine()) {
          if (/^---\s*$/.test(line.text)) {
            end = cx.lineStart + line.text.length;
            cx.nextLine();
            break;
          }
        }
        if (end === -1) end = cx.lineStart;
        cx.addElement(cx.elt("Frontmatter", start, end));
        return true;
      },
      before: "HorizontalRule",
    },
  ],
};
