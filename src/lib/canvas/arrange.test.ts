import { describe, expect, it } from "vitest";
import { align, distribute, duplicate, restack, type Box } from "./arrange";
import type { CanvasEdge, CanvasNode } from "./format";

const boxes: Box[] = [
  { id: "a", x: 0, y: 0, width: 100, height: 50 },
  { id: "b", x: 200, y: 100, width: 50, height: 100 },
];
const obj = (m: Map<string, { x: number; y: number }>) => Object.fromEntries(m);

describe("align", () => {
  it("lines boxes up along an edge or a centre line", () => {
    expect(obj(align(boxes, "left"))).toEqual({ a: { x: 0, y: 0 }, b: { x: 0, y: 100 } });
    expect(obj(align(boxes, "right"))).toEqual({ a: { x: 150, y: 0 }, b: { x: 200, y: 100 } });
    expect(obj(align(boxes, "centre"))).toEqual({ a: { x: 75, y: 0 }, b: { x: 100, y: 100 } });
    expect(obj(align(boxes, "top"))).toEqual({ a: { x: 0, y: 0 }, b: { x: 200, y: 0 } });
    expect(obj(align(boxes, "bottom"))).toEqual({ a: { x: 0, y: 150 }, b: { x: 200, y: 100 } });
    expect(obj(align(boxes, "middle"))).toEqual({ a: { x: 0, y: 75 }, b: { x: 200, y: 50 } });
  });

  it("does nothing for one box", () => {
    expect(align([boxes[0]], "left").size).toBe(0);
  });
});

describe("distribute", () => {
  it("evens the gaps, keeping the ends in place", () => {
    const row: Box[] = [
      { id: "c", x: 500, y: 9, width: 100, height: 10 },
      { id: "a", x: 0, y: 0, width: 100, height: 10 },
      { id: "b", x: 120, y: 5, width: 50, height: 10 },
    ];
    // Span 0..600, widths 250, so two gaps of 175.
    expect(obj(distribute(row, "horizontal"))).toEqual({ a: { x: 0, y: 0 }, b: { x: 275, y: 5 }, c: { x: 500, y: 9 } });
    expect(distribute(row.slice(0, 2), "vertical").size).toBe(0);
  });
});

describe("restack", () => {
  const items = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
  it("moves the chosen to the front or back, in their order", () => {
    expect(restack(items, new Set(["a", "c"]), "front").map((i) => i.id)).toEqual(["b", "d", "a", "c"]);
    expect(restack(items, new Set(["d", "b"]), "back").map((i) => i.id)).toEqual(["b", "d", "a", "c"]);
  });
});

describe("duplicate", () => {
  it("copies cards with new ids, offset, and the arrows between them only", () => {
    const nodes: CanvasNode[] = [
      { id: "a", type: "text", text: "A", x: 0, y: 0, width: 10, height: 10, color: "1", extra: { deep: [1] } },
      { id: "b", type: "file", file: "B.md", x: 50, y: 0, width: 10, height: 10 },
    ];
    const edges: CanvasEdge[] = [
      { id: "e1", fromNode: "a", toNode: "b", label: "to" },
      { id: "e2", fromNode: "a", toNode: "elsewhere" },
    ];
    let n = 0;
    const out = duplicate(nodes, edges, () => `n${++n}`);
    expect(out.nodes.map((x) => [x.id, x.x, x.y])).toEqual([
      ["n1", 30, 30],
      ["n2", 80, 30],
    ]);
    expect(out.nodes[0]).toMatchObject({ type: "text", text: "A", color: "1", extra: { deep: [1] } });
    expect(out.nodes[0].extra).not.toBe(nodes[0].extra);
    expect(out.edges).toEqual([{ id: "n3", fromNode: "n1", toNode: "n2", label: "to" }]);
  });
});
