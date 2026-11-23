import type { CanvasEdge, CanvasNode } from "./format";

/* Arranging cards on a canvas: aligning, spacing evenly, layering and duplicating. */

export interface Box {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export type Alignment = "left" | "centre" | "right" | "top" | "middle" | "bottom";

/** New positions that line the boxes up along one edge or centre line of the space they cover. */
export function align(boxes: Box[], how: Alignment): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  if (boxes.length < 2) return out;
  const left = Math.min(...boxes.map((b) => b.x));
  const right = Math.max(...boxes.map((b) => b.x + b.width));
  const top = Math.min(...boxes.map((b) => b.y));
  const bottom = Math.max(...boxes.map((b) => b.y + b.height));
  for (const b of boxes) {
    let { x, y } = b;
    if (how === "left") x = left;
    else if (how === "right") x = right - b.width;
    else if (how === "centre") x = (left + right) / 2 - b.width / 2;
    else if (how === "top") y = top;
    else if (how === "bottom") y = bottom - b.height;
    else y = (top + bottom) / 2 - b.height / 2;
    out.set(b.id, { x: Math.round(x), y: Math.round(y) });
  }
  return out;
}

/**
 * New positions with equal gaps between the boxes along an axis, keeping the first and
 * last where they are (as design tools do). Needs three or more.
 */
export function distribute(boxes: Box[], axis: "horizontal" | "vertical"): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  if (boxes.length < 3) return out;
  const h = axis === "horizontal";
  const pos = (b: Box) => (h ? b.x : b.y);
  const size = (b: Box) => (h ? b.width : b.height);
  const sorted = [...boxes].sort((a, b) => pos(a) - pos(b) || a.id.localeCompare(b.id));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const span = pos(last) + size(last) - pos(first);
  const used = sorted.reduce((n, b) => n + size(b), 0);
  const gap = (span - used) / (sorted.length - 1);
  let at = pos(first);
  for (const b of sorted) {
    out.set(b.id, h ? { x: Math.round(at), y: b.y } : { x: b.x, y: Math.round(at) });
    at += size(b) + gap;
  }
  return out;
}

/**
 * The list with the chosen items moved to the end (drawn on top) or the start (drawn
 * behind), keeping their order among themselves. A canvas file draws its cards in order.
 */
export function restack<T extends { id: string }>(items: T[], ids: Set<string>, to: "front" | "back"): T[] {
  const chosen = items.filter((i) => ids.has(i.id));
  const rest = items.filter((i) => !ids.has(i.id));
  return to === "front" ? [...rest, ...chosen] : [...chosen, ...rest];
}

/**
 * Copies of the cards, moved down and right by `offset`, with new ids, and copies of the
 * arrows between them (arrows to cards that aren't copied are left out).
 */
export function duplicate(
  nodes: CanvasNode[],
  edges: CanvasEdge[],
  newId: () => string,
  offset = 30,
): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  const ids = new Map(nodes.map((n) => [n.id, newId()]));
  return {
    nodes: nodes.map((n) => ({ ...structuredClone(n), id: ids.get(n.id)!, x: n.x + offset, y: n.y + offset })),
    edges: edges
      .filter((e) => ids.has(e.fromNode) && ids.has(e.toNode))
      .map((e) => ({ ...structuredClone(e), id: newId(), fromNode: ids.get(e.fromNode)!, toNode: ids.get(e.toNode)! })),
  };
}
