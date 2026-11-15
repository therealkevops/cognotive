/**
 * JSON Canvas 1.0 (jsoncanvas.org), the format of Obsidian's .canvas files:
 * cards ("nodes") placed on a board, and arrows ("edges") between them.
 * Fields this app doesn't know are kept, so files round-trip with Obsidian.
 */
import { parseNote, splitLinkText, type ParsedLink } from "../links/parse";

export type Side = "top" | "right" | "bottom" | "left";
/** A preset colour ("1" red … "6" purple) or a hex colour. */
export type CanvasColor = string;

interface NodeBase {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color?: CanvasColor;
  [extra: string]: unknown;
}
export interface TextNode extends NodeBase {
  type: "text";
  text: string;
}
export interface FileNode extends NodeBase {
  type: "file";
  /** Vault path of the file. */
  file: string;
  /** "#Heading" or "#^block" within a note. */
  subpath?: string;
}
export interface LinkNode extends NodeBase {
  type: "link";
  url: string;
}
export interface GroupNode extends NodeBase {
  type: "group";
  label?: string;
}
export type CanvasNode = TextNode | FileNode | LinkNode | GroupNode;

export interface CanvasEdge {
  id: string;
  fromNode: string;
  fromSide?: Side;
  /** Arrowheads: by default none at the start and an arrow at the end. */
  fromEnd?: "none" | "arrow";
  toNode: string;
  toSide?: Side;
  toEnd?: "none" | "arrow";
  color?: CanvasColor;
  label?: string;
  [extra: string]: unknown;
}

export interface CanvasData {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  [extra: string]: unknown;
}

export const EMPTY_CANVAS = '{\n\t"nodes":[],\n\t"edges":[]\n}\n';

/** Obsidian's preset colours, by number. */
export const CANVAS_COLORS: Record<string, { name: string; hex: string }> = {
  "1": { name: "Red", hex: "#e5484d" },
  "2": { name: "Orange", hex: "#f08c38" },
  "3": { name: "Yellow", hex: "#e0b11c" },
  "4": { name: "Green", hex: "#3fa05a" },
  "5": { name: "Cyan", hex: "#2aa5b8" },
  "6": { name: "Purple", hex: "#8e5bd8" },
};

/** The CSS colour for a canvas colour, or undefined for the default. */
export function colorValue(c: CanvasColor | undefined): string | undefined {
  if (!c) return undefined;
  return CANVAS_COLORS[c]?.hex ?? (/^#[0-9a-f]{3,8}$/i.test(c) ? c : undefined);
}

const SIDES = new Set(["top", "right", "bottom", "left"]);
const num = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);

/** Reads a .canvas file; tolerant of missing or odd fields. Null if it isn't JSON. */
export function parseCanvas(json: string): CanvasData | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json || "{}");
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const nodes: CanvasNode[] = [];
  for (const n of Array.isArray(r.nodes) ? r.nodes : []) {
    if (!n || typeof n !== "object" || typeof n.id !== "string") continue;
    const base = { ...n, x: num(n.x), y: num(n.y), width: num(n.width, 250), height: num(n.height, 60) };
    if (n.type === "text") nodes.push({ ...base, type: "text", text: typeof n.text === "string" ? n.text : "" });
    else if (n.type === "file" && typeof n.file === "string") nodes.push({ ...base, type: "file", file: n.file });
    else if (n.type === "link" && typeof n.url === "string") nodes.push({ ...base, type: "link", url: n.url });
    else if (n.type === "group") nodes.push({ ...base, type: "group" });
  }
  const ids = new Set(nodes.map((n) => n.id));
  const edges: CanvasEdge[] = [];
  for (const e of Array.isArray(r.edges) ? r.edges : []) {
    if (!e || typeof e !== "object" || typeof e.id !== "string") continue;
    if (!ids.has(e.fromNode) || !ids.has(e.toNode)) continue;
    const edge: CanvasEdge = { ...e };
    if (edge.fromSide && !SIDES.has(edge.fromSide)) delete edge.fromSide;
    if (edge.toSide && !SIDES.has(edge.toSide)) delete edge.toSide;
    edges.push(edge);
  }
  return { ...r, nodes, edges };
}

/** Writes a canvas the way Obsidian does (tab-indented JSON). */
export function serializeCanvas(data: CanvasData): string {
  return JSON.stringify(data, null, "\t") + "\n";
}

/** A new random id, like Obsidian's 16 hex digits. */
export function newCanvasId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Words on the board, for search: text cards, group labels and arrow labels. */
export function canvasText(data: CanvasData): string {
  return [
    ...data.nodes.map((n) => (n.type === "text" ? n.text : n.type === "group" ? (n.label ?? "") : "")),
    ...data.edges.map((e) => e.label ?? ""),
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Links from a canvas, for backlinks and the graph: each file card links to
 * its file, and [[links]] written in text cards count too. Offsets are into
 * the card text, so they're only meaningful together with `node`.
 */
export function canvasLinks(data: CanvasData): Array<ParsedLink & { node: string }> {
  const out: Array<ParsedLink & { node: string }> = [];
  for (const n of data.nodes) {
    if (n.type === "file") {
      const sub = typeof n.subpath === "string" ? splitLinkText(`x${n.subpath}`) : undefined;
      out.push({
        target: n.file,
        heading: sub?.heading,
        block: sub?.block,
        embed: true,
        kind: "wikilink",
        from: 0,
        to: 0,
        line: 1,
        node: n.id,
      });
    } else if (n.type === "text") {
      for (const l of parseNote(n.text).links) out.push({ ...l, node: n.id });
    }
  }
  return out;
}

/**
 * Labelled arrows between file cards: typed relations between notes, such as
 * "Plan" —supports→ "Goal". Unlabelled arrows are "related".
 */
export function canvasRelations(data: CanvasData): Array<{ from: string; to: string; label: string }> {
  const files = new Map(data.nodes.filter((n): n is FileNode => n.type === "file").map((n) => [n.id, n.file]));
  return data.edges
    .filter((e) => files.has(e.fromNode) && files.has(e.toNode))
    .map((e) => ({ from: files.get(e.fromNode)!, to: files.get(e.toNode)!, label: e.label?.trim() || "related" }));
}
