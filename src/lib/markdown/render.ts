import { expandQueries } from "../query/query";
import type { Element, Root as HastRoot } from "hast";
import rehypeSanitize, { defaultSchema, type Options as SanitizeSchema } from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified, type Plugin } from "unified";
import { visit } from "unist-util-visit";
import { splitFrontmatter } from "./frontmatter";
import { remarkLinks, type LinkContext } from "./remark-links";
import { remarkCallouts, remarkHighlight } from "./remark-obsidian";

/**
 * What user markdown may produce. Starts from GitHub's sanitize schema and adds
 * the classes our own plugins emit (callouts, math, code languages) and <mark>.
 * KaTeX and highlight.js run *after* sanitizing, so their trusted output isn't filtered.
 */
const schema: SanitizeSchema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), "mark"],
  // Our own links use href="#" plus data attributes; keep "#" from being clobbered.
  clobber: ["name", "id"],
  attributes: {
    ...defaultSchema.attributes,
    // One className rule per element: sanitize uses only the first one it finds.
    div: [
      ...(defaultSchema.attributes?.div ?? []),
      ["className", "callout", "callout-title", "callout-content", /^callout-[\w-]+$/, "embed", "embed-title"],
      "dataCallout",
      "dataHref",
    ],
    a: [
      ...(defaultSchema.attributes?.a ?? []).filter((x) => !(Array.isArray(x) && x[0] === "className")),
      ["className", "data-footnote-backref", "internal-link", "unresolved", "tag"],
      "dataHref",
      "dataTag",
    ],
    code: [["className", /^language-./, "math-inline", "math-display"]],
    img: [...(defaultSchema.attributes?.img ?? []), ["className", "embed-image", "embed-drawing"], "dataAsset", "width"],
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

const NO_LINKS: LinkContext = { resolve: () => null, read: () => undefined };

/*
 * KaTeX (maths) and highlight.js (code colours) are sizeable and most notes don't need them,
 * so they load the first time a rendered note does. Until then maths shows as its source and
 * code uncoloured; once loaded, everything showing rendered markdown draws again
 * (`onRendererChange`, or the `useRendererVersion` hook).
 */
type Extra = "math" | "code";
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- each plugin takes its own options
const extras: Partial<Record<Extra, Plugin<any[], HastRoot>>> = {};
const pending: Partial<Record<Extra, Promise<void>>> = {};
let version = 0;
const listeners = new Set<() => void>();

function loadExtra(kind: Extra): Promise<void> {
  if (extras[kind]) return Promise.resolve();
  pending[kind] ??= (kind === "math" ? import("./katex-plugin") : import("rehype-highlight")).then(
    (m) => {
      extras[kind] = m.default;
      version++;
      for (const l of listeners) l();
    },
    () => {
      delete pending[kind]; // offline or a stale deployment: try again next time
    },
  );
  return pending[kind]!;
}

/** Changes each time KaTeX or the highlighter finishes loading. */
export const rendererVersion = () => version;

/** Calls `fn` when KaTeX or the highlighter has loaded (render again to use it). */
export function onRendererChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Loads KaTeX and the highlighter now (tests, and async callers that can wait). */
export async function loadRendererExtras(): Promise<void> {
  await Promise.all([loadExtra("math"), loadExtra("code")]);
}

/** What the HTML needs that isn't loaded yet: maths, or code in a language to colour. */
function wanted(html: string): Extra[] {
  const out: Extra[] = [];
  if (!extras.math && /class="[^"]*\bmath-(inline|display)\b/.test(html)) out.push("math");
  if (!extras.code && /class="language-(?!math\b|mermaid\b)/.test(html)) out.push("code");
  return out;
}

function processor(ctx: LinkContext) {
  const p = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath)
    .use(remarkLinks, ctx)
    .use(remarkHighlight)
    .use(remarkCallouts)
    .use(remarkRehype)
    .use(rehypeSanitize, schema);
  if (extras.math) p.use(extras.math, { strict: "ignore" });
  if (extras.code) p.use(extras.code, { plainText: ["mermaid"], detect: false });
  return p.use(rehypeExternalLinks).use(rehypeStringify);
}

/**
 * Renders a note to sanitized HTML for the reading view. Frontmatter is not
 * rendered here (the reading view shows it as properties). Wikilinks become
 * <a class="internal-link" data-href>, tags <a class="tag" data-tag>, and
 * "![[Note]]" paragraphs embed that note. Mermaid blocks are left as
 * <pre><code class="language-mermaid"> for the client to draw.
 */
export function renderMarkdown(markdown: string, links: LinkContext = NO_LINKS): string {
  const body = splitFrontmatter(markdown).body;
  const html = String(processor(links).processSync(links.query ? expandQueries(body, links.query) : body));
  for (const kind of wanted(html)) void loadExtra(kind);
  return html;
}

/** renderMarkdown, after loading KaTeX or the highlighter if the note needs them. */
export async function renderMarkdownReady(markdown: string, links: LinkContext = NO_LINKS): Promise<string> {
  const first = renderMarkdown(markdown, links);
  const need = wanted(first);
  if (!need.length) return first;
  await Promise.all(need.map(loadExtra));
  return renderMarkdown(markdown, links);
}
