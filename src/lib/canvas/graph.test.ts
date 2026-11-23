import { describe, expect, it } from "vitest";
import type { CanvasEdge, CanvasNode } from "./format";
import { canvasGraph, dotRadius, linkLineId } from "./graph";

const card = (id: string, extra: Partial<CanvasNode> = {}): CanvasNode =>
  ({ id, type: "text", text: id, x: 0, y: 0, width: 10, height: 10, ...extra }) as CanvasNode;
const note = (id: string, file: string, subpath?: string) => card(id, { type: "file", file, ...(subpath ? { subpath } : {}) } as Partial<CanvasNode>);

describe("canvasGraph", () => {
  it("makes a dot per card (not groups) and a line per arrow", () => {
    const nodes = [card("a"), card("b"), card("g", { type: "group" } as Partial<CanvasNode>)];
    const edges: CanvasEdge[] = [
      { id: "e1", fromNode: "a", toNode: "b" },
      { id: "e2", fromNode: "a", toNode: "g" },
      { id: "e3", fromNode: "a", toNode: "a" },
    ];
    const g = canvasGraph(nodes, edges);
    expect(g.dots.map((d) => d.id)).toEqual(["a", "b"]);
    expect(g.lines).toEqual([{ id: "e1", source: "a", target: "b", kind: "arrow" }]);
    expect(g.dots.map((d) => d.degree)).toEqual([1, 1]);
  });

  it("adds a line where notes link, unless an arrow already joins the cards", () => {
    const nodes = [note("a", "A.md"), note("b", "B.md"), note("c", "C.md"), note("s", "C.md", "#Part")];
    const edges: CanvasEdge[] = [{ id: "e1", fromNode: "b", toNode: "a" }];
    const g = canvasGraph(nodes, edges, [
      { from: "A.md", to: "B.md" },
      { from: "A.md", to: "C.md" },
      { from: "C.md", to: "A.md" },
      { from: "A.md", to: "Elsewhere.md" },
    ]);
    expect(g.lines).toEqual([
      { id: "e1", source: "b", target: "a", kind: "arrow" },
      { id: linkLineId("a", "c"), source: "a", target: "c", kind: "link" },
    ]);
  });

  it("is the same every time, and spreads dots apart", () => {
    const nodes = ["a", "b", "c", "d"].map((id) => card(id));
    const edges: CanvasEdge[] = [{ id: "e", fromNode: "a", toNode: "b" }];
    const one = canvasGraph(nodes, edges);
    expect(canvasGraph(nodes, edges)).toEqual(one);
    const xs = new Set(one.dots.map((d) => `${d.x},${d.y}`));
    expect(xs.size).toBe(4);
  });

  it("sizes dots by connections", () => {
    expect(dotRadius(0)).toBeLessThan(dotRadius(4));
  });
});
