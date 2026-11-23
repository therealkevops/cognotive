import { forceLayout } from "../links/graph-layout";
import type { CanvasEdge, CanvasNode } from "./format";

/*
 * A canvas drawn as a graph: each card a dot, each arrow a line, and (optionally) a faint
 * line wherever one note card's note links to another's. The layout is worked out here and
 * never saved; the board keeps the places you gave the cards.
 */

export interface GraphDot {
  id: string;
  x: number;
  y: number;
  /** How many lines meet it (arrows and note links). */
  degree: number;
}

export interface GraphLine {
  id: string;
  source: string;
  target: string;
  /** An arrow on the canvas, or a link between the notes of two cards. */
  kind: "arrow" | "link";
}

/** Dot radius in board units: bigger the more it's connected. */
export const dotRadius = (degree: number) => Math.round(9 + 4 * Math.sqrt(degree));

export const linkLineId = (a: string, b: string) => `link:${a}:${b}`;

/**
 * The graph of a canvas. `noteLinks` are links between note paths (from → to); each is
 * drawn between the cards showing those notes, unless an arrow already joins them.
 * Groups aren't part of the graph.
 */
export function canvasGraph(
  nodes: CanvasNode[],
  edges: CanvasEdge[],
  noteLinks: Array<{ from: string; to: string }> = [],
): { dots: GraphDot[]; lines: GraphLine[] } {
  const cards = nodes.filter((n) => n.type !== "group");
  const ids = new Set(cards.map((n) => n.id));
  const lines: GraphLine[] = edges
    .filter((e) => ids.has(e.fromNode) && ids.has(e.toNode) && e.fromNode !== e.toNode)
    .map((e) => ({ id: e.id, source: e.fromNode, target: e.toNode, kind: "arrow" as const }));

  const pair = (a: string, b: string) => (a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`);
  const joined = new Set(lines.map((l) => pair(l.source, l.target)));
  const byPath = new Map<string, string[]>();
  for (const n of cards) {
    if (n.type !== "file" || n.subpath) continue;
    byPath.set(n.file, [...(byPath.get(n.file) ?? []), n.id]);
  }
  for (const { from, to } of noteLinks) {
    for (const a of byPath.get(from) ?? []) {
      for (const b of byPath.get(to) ?? []) {
        if (a === b || joined.has(pair(a, b))) continue;
        joined.add(pair(a, b));
        lines.push({ id: linkLineId(a, b), source: a, target: b, kind: "link" });
      }
    }
  }

  const degree = new Map<string, number>();
  for (const l of lines) {
    degree.set(l.source, (degree.get(l.source) ?? 0) + 1);
    degree.set(l.target, (degree.get(l.target) ?? 0) + 1);
  }
  // Laid out in a square that grows with the number of cards, centred on the board's origin.
  const order = [...ids].sort();
  const size = Math.max(480, 190 * Math.sqrt(order.length));
  const dots = forceLayout(order, lines).map((p) => ({
    id: p.id,
    x: Math.round((p.x - 0.5) * size),
    y: Math.round((p.y - 0.5) * size),
    degree: degree.get(p.id) ?? 0,
  }));
  return { dots, lines };
}
