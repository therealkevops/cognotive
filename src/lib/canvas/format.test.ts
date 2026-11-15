import { describe, expect, it } from "vitest";
import { canvasLinks, canvasRelations, canvasText, colorValue, parseCanvas, serializeCanvas } from "./format";

const sample = JSON.stringify({
  nodes: [
    { id: "t1", type: "text", text: "Idea: see [[Garden]]", x: 0, y: 0, width: 200, height: 80, custom: "kept" },
    { id: "f1", type: "file", file: "Plan.md", subpath: "#Goals", x: 300, y: 0, width: 300, height: 200 },
    { id: "f2", type: "file", file: "Notes/Goal.md", x: 700, y: 0, width: 300, height: 200, color: "4" },
    { id: "l1", type: "link", url: "https://example.com", x: 0, y: 300, width: 300, height: 200 },
    { id: "g1", type: "group", label: "Research", x: -50, y: -50, width: 1200, height: 600 },
    { id: "bad", type: "mystery", x: 0, y: 0 },
  ],
  edges: [
    { id: "e1", fromNode: "f1", fromSide: "right", toNode: "f2", toSide: "left", label: "supports" },
    { id: "e2", fromNode: "t1", toNode: "f1" },
    { id: "e3", fromNode: "f1", toNode: "missing" },
  ],
  extra: { by: "obsidian" },
});

describe("JSON Canvas", () => {
  it("reads cards and arrows, dropping broken ones and keeping unknown fields", () => {
    const c = parseCanvas(sample)!;
    expect(c.nodes.map((n) => n.id)).toEqual(["t1", "f1", "f2", "l1", "g1"]);
    expect(c.edges.map((e) => e.id)).toEqual(["e1", "e2"]);
    expect(c.nodes[0].custom).toBe("kept");
    expect(c.extra).toEqual({ by: "obsidian" });
    expect(parseCanvas("not json")).toBeNull();
    expect(parseCanvas("")).toEqual({ nodes: [], edges: [] });
  });

  it("round-trips through the tab-indented format", () => {
    const c = parseCanvas(sample)!;
    const again = parseCanvas(serializeCanvas(c))!;
    expect(again).toEqual(c);
    expect(serializeCanvas(c)).toContain('\n\t"nodes"');
  });

  it("collects text, links and labelled relations", () => {
    const c = parseCanvas(sample)!;
    expect(canvasText(c)).toBe("Idea: see [[Garden]]\nResearch\nsupports");
    expect(canvasLinks(c).map((l) => [l.target, l.heading, l.node])).toEqual([
      ["Garden", undefined, "t1"],
      ["Plan.md", "Goals", "f1"],
      ["Notes/Goal.md", undefined, "f2"],
    ]);
    expect(canvasRelations(c)).toEqual([{ from: "Plan.md", to: "Notes/Goal.md", label: "supports" }]);
  });

  it("maps preset and hex colours", () => {
    expect(colorValue("1")).toBe("#e5484d");
    expect(colorValue("#abc")).toBe("#abc");
    expect(colorValue("nope")).toBeUndefined();
    expect(colorValue(undefined)).toBeUndefined();
  });
});
