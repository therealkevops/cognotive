import { describe, expect, it } from "vitest";
import { forceLayout } from "./graph-layout";

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

describe("forceLayout", () => {
  it("handles empty and single graphs", () => {
    expect(forceLayout([], [])).toEqual([]);
    expect(forceLayout(["a"], [])).toEqual([{ id: "a", x: 0.5, y: 0.5 }]);
  });

  it("fits inside the padded area and is deterministic", () => {
    const ids = Array.from({ length: 30 }, (_, i) => `n${i}`);
    const edges = ids.slice(1).map((id, i) => ({ source: ids[i], target: id }));
    const a = forceLayout(ids, edges);
    expect(forceLayout(ids, edges)).toEqual(a);
    for (const p of a) {
      expect(p.x).toBeGreaterThanOrEqual(0.06 - 1e-9);
      expect(p.x).toBeLessThanOrEqual(0.94 + 1e-9);
      expect(p.y).toBeGreaterThanOrEqual(0.06 - 1e-9);
      expect(p.y).toBeLessThanOrEqual(0.94 + 1e-9);
    }
  });

  it("keeps linked notes closer together than unlinked ones", () => {
    // Two triangles, not connected to each other.
    const ids = ["a1", "a2", "a3", "b1", "b2", "b3"];
    const edges = [
      { source: "a1", target: "a2" },
      { source: "a2", target: "a3" },
      { source: "a3", target: "a1" },
      { source: "b1", target: "b2" },
      { source: "b2", target: "b3" },
      { source: "b3", target: "b1" },
    ];
    const p = Object.fromEntries(forceLayout(ids, edges).map((n) => [n.id, n]));
    const within = (dist(p.a1, p.a2) + dist(p.b1, p.b2)) / 2;
    const across = (dist(p.a1, p.b1) + dist(p.a2, p.b2)) / 2;
    expect(within).toBeLessThan(across);
  });
});
