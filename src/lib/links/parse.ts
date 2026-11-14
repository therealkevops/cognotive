import { parse as parseYaml } from "yaml";
import { splitFrontmatter } from "../markdown/frontmatter";

export interface ParsedLink {
  /** The link target as written: "Note", "Folder/Note", "drawing.excalidraw". */
  target: string;
  heading?: string;
  /** Block id from "#^id". */
  block?: string;
  alias?: string;
  /** "![[...]]" */
  embed: boolean;
  kind: "wikilink" | "markdown";
  /** Offsets of the whole link in the note, and its 1-based line. */
  from: number;
  to: number;
  line: number;
}

export interface ParsedNote {
  links: ParsedLink[];
  /** Lower-cased tags without "#", from the body and frontmatter. Nested tags keep "/". */
  tags: string[];
  /** Parsed YAML frontmatter, or {} if missing or invalid. */
  properties: Record<string, unknown>;
  /** Frontmatter `aliases` / `alias`. */
  aliases: string[];
  headings: Array<{ level: number; text: string }>;
  /** True if the frontmatter block isn't valid YAML. */
  propertiesError: boolean;
}

const WIKILINK = /(!?)\[\[([^\]\n]+?)\]\]/g;
// Inline markdown links/images to local files: [text](path) or ![alt](path), not URLs.
const MD_LINK = /(!?)\[([^\]\n]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const TAG = /(^|[\s(,;])#([\p{L}\p{N}_\-/]*[\p{L}_\-/][\p{L}\p{N}_\-/]*)/gu;

/**
 * Replaces fenced code, inline code and HTML comments with spaces (keeping
 * offsets and newlines) so links inside them are ignored.
 */
export function maskCode(text: string): string {
  const blank = (m: string) => m.replace(/[^\n]/g, " ");
  return text
    .replace(/^(\s{0,3})(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^\s{0,3}\2[`~]*[ \t]*$|(?![\s\S]))/gm, blank)
    .replace(/(`+)[^`\n]*?\1/g, blank)
    .replace(/<!--[\s\S]*?-->/g, blank);
}

/** "Note#Heading|Alias" → parts. Obsidian also accepts "\|" inside tables. */
export function splitLinkText(inner: string): Pick<ParsedLink, "target" | "heading" | "block" | "alias"> {
  const pipe = inner.search(/\\?\|/);
  const main = pipe === -1 ? inner : inner.slice(0, pipe);
  const alias = pipe === -1 ? undefined : inner.slice(pipe).replace(/^\\?\|/, "").trim() || undefined;
  const hash = main.indexOf("#");
  const target = (hash === -1 ? main : main.slice(0, hash)).trim();
  const sub = hash === -1 ? undefined : main.slice(hash + 1).trim();
  const out: Pick<ParsedLink, "target" | "heading" | "block" | "alias"> = { target, alias };
  if (sub?.startsWith("^")) out.block = sub.slice(1);
  else if (sub) out.heading = sub;
  return out;
}

function lineAt(text: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

function asStringList(v: unknown): string[] {
  if (typeof v === "string") return v.split(/[,\s]+/).filter(Boolean);
  if (Array.isArray(v)) return v.filter((x): x is string | number => typeof x === "string" || typeof x === "number").map(String);
  return [];
}

export function parseNote(markdown: string): ParsedNote {
  const { frontmatter, body } = splitFrontmatter(markdown);
  let properties: Record<string, unknown> = {};
  let propertiesError = false;
  if (frontmatter) {
    try {
      const yamlText = frontmatter.replace(/^---\r?\n/, "").replace(/\r?\n---[ \t]*(?:\r?\n)?$/, "");
      const parsed = parseYaml(yamlText);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) properties = parsed as Record<string, unknown>;
    } catch {
      propertiesError = true;
    }
  }

  const offset = frontmatter.length;
  const masked = maskCode(body);
  const links: ParsedLink[] = [];

  for (const m of masked.matchAll(WIKILINK)) {
    const parts = splitLinkText(m[2]);
    if (!parts.target && !parts.heading && !parts.block) continue;
    const from = offset + m.index!;
    links.push({ ...parts, embed: m[1] === "!", kind: "wikilink", from, to: from + m[0].length, line: lineAt(markdown, from) });
  }
  for (const m of masked.matchAll(MD_LINK)) {
    const href = m[3];
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("#") || href.startsWith("//")) continue;
    let decoded: string;
    try {
      decoded = decodeURIComponent(href);
    } catch {
      decoded = href;
    }
    const parts = splitLinkText(decoded);
    const from = offset + m.index!;
    links.push({
      ...parts,
      alias: m[2] || undefined,
      embed: m[1] === "!",
      kind: "markdown",
      from,
      to: from + m[0].length,
      line: lineAt(markdown, from),
    });
  }
  links.sort((a, b) => a.from - b.from);

  const tags = new Set<string>();
  // Headings start with "# ", which the tag pattern can't match (it needs a letter after "#").
  for (const m of masked.matchAll(TAG)) tags.add(m[2].toLowerCase().replace(/\/+$/, ""));
  for (const t of asStringList(properties.tags ?? properties.tag)) tags.add(t.replace(/^#/, "").toLowerCase());

  const headings: ParsedNote["headings"] = [];
  for (const m of masked.matchAll(/^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/gm)) {
    if (m[2]) headings.push({ level: m[1].length, text: m[2] });
  }

  return {
    links,
    tags: [...tags].filter(Boolean).sort(),
    properties,
    aliases: asStringList(properties.aliases ?? properties.alias).filter((a) => !/^[,\s]*$/.test(a)),
    headings,
    propertiesError,
  };
}
