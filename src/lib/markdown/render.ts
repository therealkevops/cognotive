import type { Element, Root as HastRoot } from "hast";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import rehypeSanitize, { defaultSchema, type Options as SanitizeSchema } from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { visit } from "unist-util-visit";
import { splitFrontmatter } from "./frontmatter";
import { remarkCallouts, remarkHighlight } from "./remark-obsidian";

/**
 * What user markdown may produce. Starts from GitHub's sanitize schema and adds
 * the classes our own plugins emit (callouts, math, code languages) and <mark>.
 * KaTeX and highlight.js run *after* sanitizing, so their trusted output isn't filtered.
 */
const schema: SanitizeSchema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), "mark"],
  attributes: {
    ...defaultSchema.attributes,
    div: [
      ...(defaultSchema.attributes?.div ?? []),
      ["className", "callout", "callout-title", "callout-content", /^callout-[\w-]+$/],
      "dataCallout",
    ],
    code: [["className", /^language-./, "math-inline", "math-display"]],
  },
};

/** External links open in a new tab; in-page anchors don't. */
function rehypeExternalLinks() {
  return (tree: HastRoot) => {
    visit(tree, "element", (node: Element) => {
      const href = node.tagName === "a" ? node.properties.href : undefined;
      if (typeof href === "string" && /^https?:\/\//i.test(href)) {
        node.properties.target = "_blank";
        node.properties.rel = ["noopener", "noreferrer"];
      }
    });
  };
}

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkMath)
  .use(remarkHighlight)
  .use(remarkCallouts)
  .use(remarkRehype)
  .use(rehypeSanitize, schema)
  .use(rehypeKatex, { strict: "ignore" })
  .use(rehypeHighlight, { plainText: ["mermaid"], detect: false })
  .use(rehypeExternalLinks)
  .use(rehypeStringify);

/**
 * Renders a note to sanitized HTML for the reading view. Frontmatter is not
 * rendered (phase 3 shows it as properties). Mermaid blocks are left as
 * <pre><code class="language-mermaid"> for the client to draw.
 */
export function renderMarkdown(markdown: string): string {
  return String(processor.processSync(splitFrontmatter(markdown).body));
}
