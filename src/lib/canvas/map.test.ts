import { describe, expect, it } from "vitest";
import { canvasRelations, parseCanvas, serializeCanvas } from "./format";
import { neighbourhoodCanvas } from "./map";

describe("neighbourhoodCanvas", () => {
  it("puts the note in the middle and its neighbours around it, with directed arrows", () => {
    const c = neighbourhoodCanvas("Plan.md", [
      { path: "Goal.md", direction: "out", label: "supports" },
      { path: "Notes/Idea.md", direction: "in" },
      { path: "Both.md", direction: "both" },
    ]);
    expect(c.nodes).toHaveLength(4);
    expect(c.nodes[0]).toMatchObject({ type: "file", file: "Plan.md" });
    // No two cards overlap.
    for (const a of c.nodes)
      for (const b of c.nodes)
        if (a !== b) expect(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y).toBe(true);
    expect(canvasRelations(c)).toEqual([
      { from: "Plan.md", to: "Goal.md", label: "supports" },
      { from: "Notes/Idea.md", to: "Plan.md", label: "related" },
      { from: "Plan.md", to: "Both.md", label: "related" },
    ]);
    expect(c.edges[2].fromEnd).toBe("arrow");
    // It's a valid canvas file.
    expect(parseCanvas(serializeCanvas(c))?.nodes).toHaveLength(4);
  });

  it("spreads many neighbours without overlap", () => {
    const c = neighbourhoodCanvas(
      "Hub.md",
      Array.from({ length: 16 }, (_, i) => ({ path: `N${i}.md`, direction: "out" as const })),
    );
    for (const a of c.nodes)
      for (const b of c.nodes)
        if (a !== b) expect(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y).toBe(true);
  });
});
