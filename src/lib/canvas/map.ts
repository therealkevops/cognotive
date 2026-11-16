import { newCanvasId, type CanvasData, type CanvasEdge, type FileNode, type Side } from "./format";

export interface Neighbour {
  path: string;
  /** "out": the note links to it; "in": it links to the note; "both". */
  direction: "out" | "in" | "both";
  /** A typed relation, from a labelled canvas arrow. */
  label?: string;
}

const CENTER = { width: 440, height: 340 };
const CARD = { width: 340, height: 240 };

/** The side of a card that faces a point at angle `a` (radians) from its centre. */
function facing(a: number): Side {
  const dx = Math.cos(a);
  const dy = Math.sin(a);
  return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "bottom" : "top";
}
const OPPOSITE: Record<Side, Side> = { top: "bottom", bottom: "top", left: "right", right: "left" };

/**
 * A canvas mapping a note's surroundings: the note in the middle and its
 * neighbours in a ring, joined by arrows in the direction of each link (both
 * ways for mutual links), labelled with any typed relation. A starting point
 * for the user to arrange, prune and annotate.
 */
export function neighbourhoodCanvas(center: string, neighbours: Neighbour[]): CanvasData {
  const centreNode: FileNode = {
    id: newCanvasId(),
    type: "file",
    file: center,
    x: -CENTER.width / 2,
    y: -CENTER.height / 2,
    ...CENTER,
    color: "4",
  };
  const nodes: FileNode[] = [centreNode];
  const edges: CanvasEdge[] = [];
  const n = neighbours.length;
  // A wider ring for more cards, so they don't overlap.
  const rx = Math.max(720, (n * (CARD.width + 60)) / (2 * Math.PI) + 260);
  const ry = Math.max(520, rx * 0.68);
  neighbours.forEach((nb, i) => {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / Math.max(n, 1);
    const cx = Math.cos(a) * rx;
    const cy = Math.sin(a) * ry;
    const node: FileNode = {
      id: newCanvasId(),
      type: "file",
      file: nb.path,
      x: Math.round(cx - CARD.width / 2),
      y: Math.round(cy - CARD.height / 2),
      ...CARD,
    };
    nodes.push(node);
    const side = facing(a);
    const outward = nb.direction !== "in";
    const edge: CanvasEdge = outward
      ? { id: newCanvasId(), fromNode: centreNode.id, fromSide: side, toNode: node.id, toSide: OPPOSITE[side] }
      : { id: newCanvasId(), fromNode: node.id, fromSide: OPPOSITE[side], toNode: centreNode.id, toSide: side };
    if (nb.direction === "both") edge.fromEnd = "arrow";
    if (nb.label) edge.label = nb.label;
    edges.push(edge);
  });
  return { nodes, edges };
}
