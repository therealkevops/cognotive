import type { Image, Parent, PhrasingContent, Root, RootContent, Text } from "mdast";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { visit, SKIP } from "unist-util-visit";
import { splitLinkText } from "../links/parse";
import { isDrawing, isImage } from "../vault/paths";
import { splitFrontmatter } from "./frontmatter";

export interface LinkContext {
  /** Resolves a link target to a vault path, or null. */
  resolve(target: string): string | null;
  /** Content of a note, for embeds. */
  read(path: string): string | undefined;
  /** A live query block's results as markdown; without it, query blocks show as code. */
  query?(source: string, lang: "query" | "dataview"): string;
}

const WIKILINK = /(!?)\[\[([^\]\n]+?)\]\]/g;
const TAG = /(^|[\s(,;])#([\p{L}\p{N}_\-/]*[\p{L}_\-/][\p{L}\p{N}_\-/]*)/gu;
const MAX_EMBED_DEPTH = 2;

const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath);

/** The part of a note under `heading`, up to the next heading of the same or higher level. */
export function sectionUnder(markdown: string, heading: string): string | null {
  const lines = markdown.split("\n");
  const want = heading.trim().toLowerCase();
  let start = -1;
  let level = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(lines[i]);
    if (!m) continue;
    if (start === -1) {
      if (m[2].toLowerCase() === want) {
        start = i;
        level = m[1].length;
      }
    } else if (m[1].length <= level) {
      return lines.slice(start, i).join("\n");
    }
  }
  return start === -1 ? null : lines.slice(start).join("\n");
}

function linkNode(inner: string, ctx: LinkContext): PhrasingContent {
  const { target, heading, alias } = splitLinkText(inner);
  const resolved = target ? ctx.resolve(target) : "self";
  const label = alias ?? (heading ? (target ? `${target} › ${heading}` : heading) : target);
  return {
    type: "link",
    url: "#",
    data: {
      hProperties: {
        className: resolved ? ["internal-link"] : ["internal-link", "unresolved"],
        dataHref: inner.split(/\\?\|/)[0],
      },
    },
    children: [{ type: "text", value: label }],
  };
}

/**
 * An image or drawing embed. The src is filled in by the reading view (from the
 * vault, as an object URL), so the HTML only carries the vault path.
 * "![[pic.png|300]]" sets the width.
 */
function assetNode(inner: string, path: string): Image {
  const { alias } = splitLinkText(inner);
  const width = alias && /^\d+(x\d+)?$/.test(alias) ? alias.split("x")[0] : undefined;
  return {
    type: "image",
    url: "",
    alt: alias && !width ? alias : path.split("/").pop()!.replace(/\.excalidraw$/i, ""),
    data: {
      hProperties: {
        className: [isDrawing(path) ? "embed-drawing" : "embed-image"],
        dataAsset: path,
        ...(width ? { width } : {}),
      },
    },
  };
}

function assetPath(inner: string, ctx: LinkContext): string | null {
  const { target } = splitLinkText(inner);
  const path = target ? ctx.resolve(target) : null;
  return path && (isImage(path) || isDrawing(path)) ? path : null;
}

function embedBlock(inner: string, ctx: LinkContext, depth: number): RootContent {
  const asset = assetPath(inner, ctx);
  if (asset) return { type: "paragraph", children: [assetNode(inner, asset)] };
  const { target, heading } = splitLinkText(inner);
  const path = target ? ctx.resolve(target) : null;
  let children: RootContent[];
  if (!path || !path.endsWith(".md")) {
    children = [{ type: "paragraph", children: [linkNode(inner, ctx)] }];
  } else if (depth >= MAX_EMBED_DEPTH) {
    children = [{ type: "paragraph", children: [linkNode(inner, ctx)] }];
  } else {
    const body = splitFrontmatter(ctx.read(path) ?? "").body;
    const part = heading ? (sectionUnder(body, heading) ?? "") : body;
    const tree = parser.runSync(parser.parse(part)) as Root;
    transform(tree, ctx, depth + 1);
    children = tree.children;
  }
  return {
    type: "blockquote",
    data: { hName: "div", hProperties: { className: ["embed"], dataHref: inner } },
    children: [
      {
        type: "paragraph",
        data: { hName: "div", hProperties: { className: ["embed-title"] } },
        children: [linkNode(inner, ctx)],
      },
      ...(children as Array<Root["children"][number]>),
    ] as Parent["children"] as never,
  };
}

/** Splits text nodes on wikilinks and #tags. */
function splitText(value: string, ctx: LinkContext): PhrasingContent[] | null {
  const out: PhrasingContent[] = [];
  let last = 0;
  const push = (s: string) => s && out.push(...splitTags(s));
  for (const m of value.matchAll(WIKILINK)) {
    push(value.slice(last, m.index));
    const asset = m[1] === "!" ? assetPath(m[2], ctx) : null;
    out.push(asset ? assetNode(m[2], asset) : linkNode(m[2], ctx));
    last = m.index! + m[0].length;
  }
  if (last === 0) {
    const tagged = splitTags(value);
    return tagged.length === 1 && tagged[0].type === "text" ? null : tagged;
  }
  push(value.slice(last));
  return out;
}

function splitTags(value: string): PhrasingContent[] {
  const out: PhrasingContent[] = [];
  let last = 0;
  for (const m of value.matchAll(TAG)) {
    const start = m.index! + m[1].length;
    if (start > last) out.push({ type: "text", value: value.slice(last, start) });
    out.push({
      type: "link",
      url: "#",
      data: { hProperties: { className: ["tag"], dataTag: m[2].toLowerCase() } },
      children: [{ type: "text", value: `#${m[2]}` }],
    });
    last = start + m[2].length + 1;
  }
  if (last < value.length) out.push({ type: "text", value: value.slice(last) });
  return out;
}

function transform(tree: Root, ctx: LinkContext, depth: number) {
  // Markdown images pointing into the vault: ![alt](attachments/pic.png)
  visit(tree, "image", (node: Image) => {
    if (!node.url || /^[a-z][a-z0-9+.-]*:/i.test(node.url) || node.url.startsWith("//")) return;
    let target = node.url;
    try {
      target = decodeURIComponent(target);
    } catch {
      // keep as written
    }
    const path = ctx.resolve(target);
    if (!path) return;
    node.url = "";
    node.data = {
      ...node.data,
      hProperties: { className: [isDrawing(path) ? "embed-drawing" : "embed-image"], dataAsset: path },
    };
  });
  // Block embeds: a paragraph that is only "![[...]]".
  visit(tree, "paragraph", (node, index, parent) => {
    if (!parent || index === undefined) return;
    const only = node.children.length === 1 && node.children[0].type === "text" ? (node.children[0] as Text).value.trim() : "";
    const m = /^!\[\[([^\]\n]+?)\]\]$/.exec(only);
    if (!m) return;
    parent.children.splice(index, 1, embedBlock(m[1], ctx, depth) as never);
    return [SKIP, index + 1];
  });
  visit(tree, "text", (node: Text, index, parent) => {
    if (!parent || index === undefined) return;
    if (parent.type === "link" || parent.type === "linkReference") return;
    // Block ids ("text ^abc123") are link targets, not content: hide them, as Obsidian does.
    if (index === parent.children.length - 1) node.value = node.value.replace(/\s\^[A-Za-z0-9-]+\s*$/, "");
    const parts = splitText(node.value, ctx);
    if (!parts) return;
    parent.children.splice(index, 1, ...(parts as never[]));
    return [SKIP, index + parts.length];
  });
}

/** Wikilinks, embeds and tags for the reading view. */
export function remarkLinks(ctx: LinkContext) {
  return (tree: Root) => transform(tree, ctx, 0);
}
