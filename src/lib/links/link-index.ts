import { drawingJson, isObsidianDrawing, replaceScene } from "../drawing/obsidian";
import { parseDrawing, rewriteDrawingLinks } from "../drawing/parse";
import { canvasLinks, canvasRelations, parseCanvas, serializeCanvas } from "../canvas/format";
import { canvasName, dirname, drawingName, isCanvas, isDrawing, isNote, noteTitle, relativePath } from "../vault/paths";
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
  kind: "note" | "drawing" | "canvas";
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
  /** A canvas's labelled arrows between file cards (targets as written). */
  relations?: Array<{ from: string; to: string; label: string }>;
}

/** A labelled arrow on a canvas that touches a note. */
export interface CanvasRelation {
  canvas: string;
  /** The note at the other end of the arrow (resolved path, or the target as written). */
  other: string;
  resolved: boolean;
  label: string;
  /** "out": this note → other; "in": other → this note. */
  direction: "out" | "in";
}

const EMPTY_PARSED: Omit<ParsedNote, "links"> = {
  tags: [],
  properties: {},
  aliases: [],
  headings: [],
  propertiesError: false,
};

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
    if (isDrawing(path)) {
      const { links } = parseDrawing(drawingJson(path, content));
      this.notes.set(path, {
        content,
        parsed: { links, tags: [], properties: {}, aliases: [], headings: [], propertiesError: false },
      });
    } else if (isCanvas(path)) {
      const data = parseCanvas(content);
      this.notes.set(path, {
        content,
        parsed: { ...EMPTY_PARSED, links: data ? canvasLinks(data) : [] },
        relations: data ? canvasRelations(data) : [],
      });
    } else if (isNote(path)) this.notes.set(path, { content, parsed: parseNote(content) });
  }

  /** Labelled arrows on canvases between `path` and other notes, as typed relations. */
  canvasRelations(path: string): CanvasRelation[] {
    const out: CanvasRelation[] = [];
    for (const [canvas, e] of this.notes) {
      for (const r of e.relations ?? []) {
        const from = this.resolve(r.from, canvas);
        const to = this.resolve(r.to, canvas);
        if (from === path && to !== path) {
          out.push({ canvas, other: to ?? r.to, resolved: !!to, label: r.label, direction: "out" });
        } else if (to === path && from !== path) {
          out.push({ canvas, other: from ?? r.from, resolved: !!from, label: r.label, direction: "in" });
        }
      }
    }
    return out;
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
          const context = isDrawing(source)
            ? "Linked from the drawing"
            : isCanvas(source)
              ? "On the canvas"
              : lineText(e.content, link.from);
          out.push({ source, line: link.line, context, link });
        }
      }
    }
    return out.sort((a, b) => a.source.localeCompare(b.source) || a.line - b.line);
  }

  /** How many other notes link to each file, in one pass (for ranking suggestions). */
  inboundCounts(): Map<string, number> {
    const out = new Map<string, number>();
    for (const [source, e] of this.notes) {
      const seen = new Set<string>();
      for (const link of e.parsed.links) {
        const p = link.target ? this.resolve(link.target, source) : null;
        if (p && p !== source && !seen.has(p)) {
          seen.add(p);
          out.set(p, (out.get(p) ?? 0) + 1);
        }
      }
    }
    return out;
  }

  /**
   * Notes related to `path` without linking to it directly: they link to the
   * same notes (shared targets) or are linked from the same notes (shared
   * sources). Strongest first, with up to three of the notes they share.
   */
  related(path: string, limit = 8): Array<{ path: string; score: number; via: string[] }> {
    const outOf = new Map<string, Set<string>>();
    const into = new Map<string, Set<string>>();
    for (const [source, e] of this.notes) {
      const set = new Set<string>();
      for (const l of e.parsed.links) {
        const p = l.target ? this.resolve(l.target, source) : null;
        if (!p || p === source) continue;
        set.add(p);
        if (!into.has(p)) into.set(p, new Set());
        into.get(p)!.add(source);
      }
      outOf.set(source, set);
    }
    const mineOut = outOf.get(path) ?? new Set<string>();
    const mineIn = into.get(path) ?? new Set<string>();
    const out: Array<{ path: string; score: number; via: string[] }> = [];
    for (const other of this.notes.keys()) {
      if (other === path || !isNote(other) || mineOut.has(other) || mineIn.has(other)) continue;
      const shared = new Set<string>();
      for (const t of outOf.get(other) ?? []) if (mineOut.has(t)) shared.add(t);
      for (const s of into.get(other) ?? []) if (mineIn.has(s)) shared.add(s);
      if (shared.size) out.push({ path: other, score: shared.size, via: [...shared].slice(0, 3) });
    }
    return out.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path)).slice(0, limit);
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
      if (source === path || isDrawing(source) || isCanvas(source)) continue;
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

  /**
   * The other way round from `unlinkedMentions`: other notes' titles (or
   * aliases) mentioned as plain text inside `path`, first mention of each,
   * in order. `target` is the mentioned note.
   */
  mentionsIn(path: string, limit = 5): Array<Mention & { target: string }> {
    const e = this.notes.get(path);
    if (!e) return [];
    const byName = new Map<string, string>();
    for (const [p, other] of this.notes) {
      if (p === path || isDrawing(p) || isCanvas(p)) continue;
      for (const n of [noteTitle(p), ...other.parsed.aliases]) {
        if (n.trim().length >= 3 && !byName.has(n.toLowerCase())) byName.set(n.toLowerCase(), p);
      }
    }
    if (byName.size === 0) return [];
    const pattern = new RegExp(
      `(?<![\\p{L}\\p{N}_])(${[...byName.keys()].map(escapeRegExp).sort((a, b) => b.length - a.length).join("|")})(?![\\p{L}\\p{N}_])`,
      "giu",
    );
    const masked = maskLinks(e.content, e.parsed);
    const out: Array<Mention & { target: string }> = [];
    const seen = new Set<string>();
    for (const m of masked.matchAll(pattern)) {
      const target = byName.get(m[0].toLowerCase())!;
      if (seen.has(target)) continue;
      seen.add(target);
      const from = m.index!;
      out.push({ source: path, target, from, text: m[0], line: lineNumber(e.content, from), context: lineText(e.content, from) });
      if (out.length >= limit) break;
    }
    return out;
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
        title: isDrawing(p) ? drawingName(p) : isCanvas(p) ? canvasName(p) : noteTitle(p),
        kind: isDrawing(p) ? "drawing" : isCanvas(p) ? "canvas" : "note",
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
      if (isCanvas(source)) {
        const updated = rewriteCanvas(e.content, source, oldPath, newPath, newText, resolveOld);
        if (updated) out.set(source, updated);
        continue;
      }
      if (isDrawing(source)) {
        const updated = rewriteDrawingLinks(drawingJson(source, e.content), (t) => resolveOld(t, source) === oldPath, newText);
        if (updated) out.set(source, isObsidianDrawing(source) ? replaceScene(e.content, updated) : updated);
        continue;
      }
      const edits: Array<{ from: number; to: number; insert: string }> = [];
      for (const link of e.parsed.links) {
        if (!link.target || resolveOld(link.target, source) !== oldPath) continue;
        const raw = e.content.slice(link.from, link.to);
        edits.push({ from: link.from, to: link.to, insert: retarget(raw, link, newText, newPath, source) });
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

  /**
   * Before deleting files, turns links to them into plain text: a wikilink
   * becomes its alias or note name, a markdown link its label, and embeds are
   * removed. Returns the new contents of each note that changes. Drawings and
   * notes that are themselves being deleted are left alone.
   */
  unlinkTo(isGone: (path: string) => boolean): Map<string, string> {
    const out = new Map<string, string>();
    for (const [source, e] of this.notes) {
      if (isDrawing(source) || isCanvas(source) || isGone(source)) continue;
      const edits: Array<{ from: number; to: number; insert: string }> = [];
      for (const link of e.parsed.links) {
        const p = link.target ? this.resolve(link.target, source) : null;
        if (!p || !isGone(p)) continue;
        edits.push({ from: link.from, to: link.to, insert: plainLinkText(e.content.slice(link.from, link.to), link) });
      }
      if (!edits.length) continue;
      let text = e.content;
      for (const ed of edits.sort((a, b) => b.from - a.from)) {
        text = text.slice(0, ed.from) + ed.insert + text.slice(ed.to);
      }
      out.set(source, text);
    }
    return out;
  }

  /** A resolver snapshot, for answering "where did this link point before?" during renames. */
  snapshotResolver(): (target: string, from: string) => string | null {
    const copy = new Resolver(this.resolver.list());
    return (t, f) => copy.resolve(t, f);
  }
}

function retarget(raw: string, link: ParsedLink, newText: string, newPath: string, source: string): string {
  const sub = link.block ? `#^${link.block}` : link.heading ? `#${link.heading}` : "";
  if (link.kind === "wikilink") {
    const alias = link.alias ? `|${link.alias}` : "";
    return `${link.embed ? "!" : ""}[[${newText}${sub}${alias}]]`;
  }
  // Markdown link: keep the label, point at the new path, relative to the
  // linking note (as github.com reads it), with spaces URL-encoded.
  const label = raw.slice(raw.indexOf("[") + 1, raw.indexOf("]("));
  const href = relativePath(dirname(source), newPath).split("/").map(encodeURIComponent).join("/") + (sub ? encodeURI(sub) : "");
  return `${link.embed ? "!" : ""}[${label}](${href})`;
}

/**
 * A canvas after `oldPath` was renamed to `newPath`: file cards that showed it
 * point at the new path, and [[links]] to it in text cards are updated.
 */
function rewriteCanvas(
  content: string,
  source: string,
  oldPath: string,
  newPath: string,
  newText: string,
  resolveOld: (target: string, from: string) => string | null,
): string | null {
  const data = parseCanvas(content);
  if (!data) return null;
  let changed = false;
  for (const n of data.nodes) {
    if (n.type === "file" && resolveOld(n.file, source) === oldPath) {
      n.file = newPath;
      changed = true;
    } else if (n.type === "text") {
      const edits = parseNote(n.text)
        .links.filter((l) => l.target && resolveOld(l.target, source) === oldPath)
        .map((l) => ({ from: l.from, to: l.to, insert: retarget(n.text.slice(l.from, l.to), l, newText, newPath, source) }));
      for (const ed of edits.sort((a, b) => b.from - a.from)) {
        n.text = n.text.slice(0, ed.from) + ed.insert + n.text.slice(ed.to);
        changed = true;
      }
    }
  }
  return changed ? serializeCanvas(data) : null;
}

/** What a link reads as without the link. */
function plainLinkText(raw: string, link: ParsedLink): string {
  if (link.embed) return "";
  if (link.kind === "markdown") return raw.slice(raw.indexOf("[") + 1, raw.indexOf("]("));
  if (link.alias) return link.alias;
  const name = link.target.slice(link.target.lastIndexOf("/") + 1).replace(/\.md$/i, "");
  return link.heading ? `${name} › ${link.heading}` : name;
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
