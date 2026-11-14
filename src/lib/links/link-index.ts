import { parseDrawing, rewriteDrawingLinks } from "../drawing/parse";
import { isDrawing, isMarkdown, noteTitle } from "../vault/paths";
import { parseNote, splitLinkText, type ParsedLink, type ParsedNote } from "./parse";
import { Resolver } from "./resolve";

export interface Backlink {
  /** The note that links here. */
  source: string;
  line: number;
  /** The text of that line, for context. */
  context: string;
  link: ParsedLink;
}

export interface Mention {
  source: string;
  line: number;
  context: string;
  /** Offset of the mention in the source note, and the matched text. */
  from: number;
  text: string;
}

export interface GraphNode {
  id: string;
  title: string;
  kind: "note" | "drawing";
  /** Unresolved link targets appear as ghost nodes. */
  unresolved: boolean;
  tags: string[];
  degree: number;
}

export interface GraphEdge {
  source: string;
  target: string;
}

interface Entry {
  content: string;
  parsed: ParsedNote;
}

/**
 * The vault's knowledge graph, built from the text of every note: links
 * (resolved to paths), backlinks, unresolved links, tags, aliases and
 * properties. Kept up to date note by note as files change.
 */
export class LinkIndex {
  private notes = new Map<string, Entry>();
  /** Every file in the vault (notes and others), for resolution. */
  private resolver = new Resolver();

  /** Registers a file that can be linked to but isn't parsed (e.g. a drawing). */
  addFile(path: string): void {
    this.resolver.add(path);
  }

  set(path: string, content: string): void {
    this.resolver.add(path);
    if (isMarkdown(path)) this.notes.set(path, { content, parsed: parseNote(content) });
    else if (isDrawing(path)) {
      const { links } = parseDrawing(content);
      this.notes.set(path, {
        content,
        parsed: { links, tags: [], properties: {}, aliases: [], headings: [], propertiesError: false },
      });
    }
  }

  remove(path: string): void {
    this.resolver.remove(path);
    this.notes.delete(path);
  }

  clear(): void {
    this.notes.clear();
    this.resolver = new Resolver();
  }

  has(path: string): boolean {
    return this.notes.has(path);
  }

  get(path: string): ParsedNote | undefined {
    return this.notes.get(path)?.parsed;
  }

  content(path: string): string | undefined {
    return this.notes.get(path)?.content;
  }

  paths(): string[] {
    return [...this.notes.keys()];
  }

  resolve(target: string, from?: string): string | null {
    return this.resolver.resolve(target, from);
  }

  linkText(path: string): string {
    return this.resolver.linkText(path);
  }

  /** Outgoing links of a note, each with where it resolves (null = unresolved). */
  outgoing(path: string): Array<{ link: ParsedLink; resolved: string | null }> {
    const e = this.notes.get(path);
    if (!e) return [];
    return e.parsed.links.map((link) => ({ link, resolved: this.resolve(link.target, path) }));
  }

  backlinks(path: string): Backlink[] {
    const out: Backlink[] = [];
    for (const [source, e] of this.notes) {
      if (source === path) continue;
      for (const link of e.parsed.links) {
        if (this.resolve(link.target, source) === path) {
          const context = isDrawing(source) ? "Linked from the drawing" : lineText(e.content, link.from);
          out.push({ source, line: link.line, context, link });
        }
      }
    }
    return out.sort((a, b) => a.source.localeCompare(b.source) || a.line - b.line);
  }

  /** Link targets that don't match any file: target → notes that use it. */
  unresolved(): Map<string, string[]> {
    const out = new Map<string, string[]>();
    for (const [source, e] of this.notes) {
      for (const link of e.parsed.links) {
        if (!link.target || this.resolve(link.target, source)) continue;
        const key = link.target;
        const list = out.get(key) ?? [];
        if (!list.includes(source)) list.push(source);
        out.set(key, list);
      }
    }
    return out;
  }

  /**
   * Places where other notes mention this note's title or an alias as plain
   * text, without linking it. Whole words, case-insensitive; skips text inside
   * links and code.
   */
  unlinkedMentions(path: string): Mention[] {
    const e = this.notes.get(path);
    if (!e) return [];
    const names = [noteTitle(path), ...e.parsed.aliases].filter((n) => n.trim().length >= 3);
    if (!names.length) return [];
    const pattern = new RegExp(
      `(?<![\\p{L}\\p{N}_])(${names.map(escapeRegExp).sort((a, b) => b.length - a.length).join("|")})(?![\\p{L}\\p{N}_])`,
      "giu",
    );
    const out: Mention[] = [];
    for (const [source, other] of this.notes) {
      if (source === path || isDrawing(source)) continue;
      const masked = maskLinks(other.content, other.parsed);
      for (const m of masked.matchAll(pattern)) {
        const from = m.index!;
        out.push({
          source,
          from,
          text: m[0],
          line: lineNumber(other.content, from),
          context: lineText(other.content, from),
        });
      }
    }
    return out.sort((a, b) => a.source.localeCompare(b.source) || a.from - b.from);
  }

  /** Tag → number of notes using it (nested tags count toward their parents too). */
  tags(): Map<string, number> {
    const counts = new Map<string, number>();
    for (const e of this.notes.values()) {
      const seen = new Set<string>();
      for (const t of e.parsed.tags) {
        const parts = t.split("/");
        for (let i = 1; i <= parts.length; i++) seen.add(parts.slice(0, i).join("/"));
      }
      for (const t of seen) counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    return counts;
  }

  /** Notes tagged with `tag` or any tag nested under it. */
  withTag(tag: string): string[] {
    const t = tag.replace(/^#/, "").toLowerCase();
    return [...this.notes]
      .filter(([, e]) => e.parsed.tags.some((x) => x === t || x.startsWith(t + "/")))
      .map(([p]) => p)
      .sort();
  }

  /** The whole graph: notes as nodes, resolved links as edges (deduplicated), optional ghost nodes. */
  graph(opts: { includeUnresolved?: boolean } = {}): { nodes: GraphNode[]; edges: GraphEdge[] } {
    const nodes = new Map<string, GraphNode>();
    for (const [p, e] of this.notes) {
      nodes.set(p, {
        id: p,
        title: noteTitle(p).replace(/\.excalidraw$/i, ""),
        kind: isDrawing(p) ? "drawing" : "note",
        unresolved: false,
        tags: e.parsed.tags,
        degree: 0,
      });
    }
    const edges = new Map<string, GraphEdge>();
    for (const [source, e] of this.notes) {
      for (const link of e.parsed.links) {
        if (!link.target) continue;
        let target = this.resolve(link.target, source);
        if (!target) {
          if (!opts.includeUnresolved) continue;
          target = `unresolved:${link.target.toLowerCase()}`;
          if (!nodes.has(target)) {
            nodes.set(target, { id: target, title: link.target, kind: "note", unresolved: true, tags: [], degree: 0 });
          }
        }
        if (target === source || !nodes.has(target)) continue;
        const key = `${source}\u0000${target}`;
        if (!edges.has(key)) edges.set(key, { source, target });
      }
    }
    for (const e of edges.values()) {
      nodes.get(e.source)!.degree++;
      nodes.get(e.target)!.degree++;
    }
    return { nodes: [...nodes.values()], edges: [...edges.values()] };
  }

  /** Notes within `depth` links of `path`, following links in both directions. */
  neighborhood(path: string, depth: number, opts: { includeUnresolved?: boolean } = {}) {
    const g = this.graph(opts);
    const adj = new Map<string, Set<string>>();
    for (const e of g.edges) {
      if (!adj.has(e.source)) adj.set(e.source, new Set());
      if (!adj.has(e.target)) adj.set(e.target, new Set());
      adj.get(e.source)!.add(e.target);
      adj.get(e.target)!.add(e.source);
    }
    const keep = new Set([path]);
    let frontier = [path];
    for (let d = 0; d < depth; d++) {
      const next: string[] = [];
      for (const n of frontier) {
        for (const m of adj.get(n) ?? []) {
          if (keep.has(m)) continue;
          keep.add(m);
          next.push(m);
        }
      }
      frontier = next;
    }
    return {
      nodes: g.nodes.filter((n) => keep.has(n.id)),
      edges: g.edges.filter((e) => keep.has(e.source) && keep.has(e.target)),
    };
  }

  /** Notes with no links in or out. */
  orphans(): string[] {
    const g = this.graph();
    return g.nodes.filter((n) => n.degree === 0).map((n) => n.id).sort();
  }

  /**
   * After `oldPath` was renamed to `newPath` (already applied via set/remove),
   * returns updated contents for every note whose links pointed at the old path.
   * Each link keeps its heading, block and alias; only the target text changes.
   * `resolveOld` answers how links resolved *before* the rename.
   */
  rewriteLinksTo(
    oldPath: string,
    newPath: string,
    resolveOld: (target: string, from: string) => string | null,
  ): Map<string, string> {
    const out = new Map<string, string>();
    const newText = this.linkText(newPath);
    for (const [source, e] of this.notes) {
      if (isDrawing(source)) {
        const updated = rewriteDrawingLinks(e.content, (t) => resolveOld(t, source) === oldPath, newText);
        if (updated) out.set(source, updated);
        continue;
      }
      const edits: Array<{ from: number; to: number; insert: string }> = [];
      for (const link of e.parsed.links) {
        if (!link.target || resolveOld(link.target, source) !== oldPath) continue;
        const raw = e.content.slice(link.from, link.to);
        edits.push({ from: link.from, to: link.to, insert: retarget(raw, link, newText, newPath) });
      }
      if (!edits.length) continue;
      let text = e.content;
      for (const ed of edits.sort((a, b) => b.from - a.from)) {
        text = text.slice(0, ed.from) + ed.insert + text.slice(ed.to);
      }
      if (text !== e.content) out.set(source, text);
    }
    return out;
  }

  /** A resolver snapshot, for answering "where did this link point before?" during renames. */
  snapshotResolver(): (target: string, from: string) => string | null {
    const copy = new Resolver(this.resolver.list());
    return (t, f) => copy.resolve(t, f);
  }
}

function retarget(raw: string, link: ParsedLink, newText: string, newPath: string): string {
  const sub = link.block ? `#^${link.block}` : link.heading ? `#${link.heading}` : "";
  if (link.kind === "wikilink") {
    const alias = link.alias ? `|${link.alias}` : "";
    return `${link.embed ? "!" : ""}[[${newText}${sub}${alias}]]`;
  }
  // Markdown link: keep the label, point at the new path (URL-encoded spaces).
  const label = raw.slice(raw.indexOf("[") + 1, raw.indexOf("]("));
  const href = newPath.split("/").map(encodeURIComponent).join("/") + (sub ? encodeURI(sub) : "");
  return `${link.embed ? "!" : ""}[${label}](${href})`;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function lineNumber(text: string, offset: number): number {
  let n = 1;
  for (let i = 0; i < offset; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

function lineText(text: string, offset: number): string {
  const start = text.lastIndexOf("\n", offset - 1) + 1;
  const end = text.indexOf("\n", offset);
  return text.slice(start, end === -1 ? undefined : end).trim();
}

/** Blanks out frontmatter, code, and existing links so mentions inside them aren't counted. */
function maskLinks(content: string, parsed: ParsedNote): string {
  let out = content;
  const fm = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(content)?.[0] ?? "";
  const blank = (s: string) => s.replace(/[^\n]/g, " ");
  out = blank(fm) + out.slice(fm.length);
  for (const l of parsed.links) out = out.slice(0, l.from) + blank(out.slice(l.from, l.to)) + out.slice(l.to);
  out = out.replace(/(`+)[^`\n]*?\1/g, blank).replace(/^(\s{0,3})(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\s{0,3}\2[`~]*[ \t]*$/gm, blank);
  // URLs often contain words that look like titles.
  return out.replace(/https?:\/\/\S+/g, blank);
}

export { splitLinkText };
