import { basename, dirname, isMarkdown, relativePath } from "../vault/paths";
import { parseNote, type ParsedLink } from "./parse";

/** How new links are written: Obsidian wikilinks, or markdown links that work on github.com. */
export type LinkFormat = "wikilink" | "markdown";

export interface LinkSpec {
  /** The file linked to, if it exists. */
  path: string | null;
  /** The target as written, used when the file doesn't exist yet. */
  target: string;
  /** A heading, or "^id" for a block. */
  sub?: string;
  /** Text to show instead of the note name. */
  alias?: string;
  embed?: boolean;
}

/** The name a link shows by default: the note title, or a file's name. */
function displayName(spec: LinkSpec): string {
  const name = basename(spec.path ?? spec.target);
  return isMarkdown(name) ? name.slice(0, -3) : name;
}

function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

/**
 * A markdown link from the note at `from` to `spec`, with a path relative to
 * that note's folder (as github.com expects): [Note](../Other/Note.md#Heading).
 * A note that doesn't exist yet is linked in the same folder.
 */
export function markdownLink(from: string, spec: LinkSpec): string {
  const to = spec.path ?? (/\.[A-Za-z0-9]+$/.test(spec.target) && !spec.target.includes(" ") ? spec.target : `${spec.target}.md`);
  const href = spec.path ? relativePath(dirname(from), to) : to;
  const sub = spec.sub ? `#${spec.sub.startsWith("^") ? spec.sub : encodeURIComponent(spec.sub)}` : "";
  const label = spec.alias ?? (spec.sub && !spec.sub.startsWith("^") ? `${displayName(spec)} › ${spec.sub}` : displayName(spec));
  return `${spec.embed ? "!" : ""}[${label.replace(/[[\]]/g, "\\$&")}](${encodePath(href)}${sub})`;
}

/** A wikilink to `spec`, using `linkText` (the shortest unambiguous name) for an existing file. */
export function wikilink(spec: LinkSpec, linkText?: string): string {
  const target = spec.path && linkText ? linkText : spec.target;
  const sub = spec.sub ? `#${spec.sub}` : "";
  const alias = spec.alias && spec.alias !== target ? `|${spec.alias}` : "";
  return `${spec.embed ? "!" : ""}[[${target}${sub}${alias}]]`;
}

export function formatLink(format: LinkFormat, from: string, spec: LinkSpec, linkText?: string): string {
  return format === "markdown" ? markdownLink(from, spec) : wikilink(spec, linkText);
}

/**
 * Rewrites every link in a note into one format: wikilinks to markdown links
 * or the reverse. Links whose target doesn't exist yet are converted too.
 * Returns the new text (unchanged if nothing needed converting).
 */
export function convertLinks(
  content: string,
  from: string,
  to: LinkFormat,
  resolve: (target: string) => string | null,
  linkText: (path: string) => string,
): string {
  const edits: Array<{ from: number; to: number; insert: string }> = [];
  for (const link of parseNote(content).links) {
    const want = to === "markdown" ? "markdown" : "wikilink";
    if (link.kind === want || (!link.target && to === "markdown")) continue;
    const path = link.target ? resolve(link.target) : from;
    const spec = specOf(link, path, content.slice(link.from, link.to));
    edits.push({
      from: link.from,
      to: link.to,
      insert: to === "markdown" ? markdownLink(from, spec) : wikilink(spec, path ? linkText(path) : undefined),
    });
  }
  let text = content;
  for (const e of edits.sort((a, b) => b.from - a.from)) text = text.slice(0, e.from) + e.insert + text.slice(e.to);
  return text;
}

function specOf(link: ParsedLink, path: string | null, raw: string): LinkSpec {
  const sub = link.block ? `^${link.block}` : link.heading;
  let alias = link.alias;
  if (link.kind === "markdown") {
    // A markdown link's label is its text; drop it if it just repeats the name.
    const name = basename(path ?? link.target).replace(/\.md$/i, "");
    const label = raw.slice(raw.indexOf("[") + 1, raw.indexOf("]("));
    alias = !label || label === name || label === `${name} › ${link.heading}` ? undefined : label;
  }
  return { path, target: link.target.replace(/\.md$/i, ""), sub, alias, embed: link.embed };
}
