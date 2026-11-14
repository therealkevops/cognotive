import type { Parent, PhrasingContent, Root, RootContent, Text } from "mdast";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { visit, SKIP } from "unist-util-visit";
import { splitLinkText } from "../links/parse";
import { splitFrontmatter } from "./frontmatter";

export interface LinkContext {
  /** Resolves a link target to a vault path, or null. */
  resolve(target: string): string | null;
  /** Content of a note, for embeds. */
  read(path: string): string | undefined;
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

function embedBlock(inner: string, ctx: LinkContext, depth: number): RootContent {
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
    out.push(linkNode(m[2], ctx));
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
