import { describe, expect, it } from "vitest";
import { arrowEnds, arrowLine, arrowRoute, dashPattern, withArrowStyle } from "./arrow-style";
import type { CanvasEdge } from "./format";

const e: CanvasEdge = { id: "e", fromNode: "a", toNode: "b" };

describe("arrow style", () => {
  it("reads the defaults: curved, an arrowhead at the end, solid", () => {
    expect([arrowRoute(e), arrowEnds(e), arrowLine(e), dashPattern(e)]).toEqual(["curved", "end", "solid", undefined]);
  });

  it("reads JSON Canvas ends and Advanced Canvas style attributes", () => {
    const styled: CanvasEdge = { ...e, fromEnd: "arrow", styleAttributes: { pathfindingMethod: "square", path: "dotted" } };
    expect([arrowRoute(styled), arrowEnds(styled), arrowLine(styled)]).toEqual(["elbow", "both", "dotted"]);
    expect(arrowEnds({ ...e, toEnd: "none" })).toBe("none");
    expect(arrowLine({ ...e, styleAttributes: { path: "short-dashed" } })).toBe("dashed");
  });

  it("writes changes and keeps other fields", () => {
    const keep = { ...e, label: "x", styleAttributes: { other: 1 } };
    const s = withArrowStyle(keep, { route: "straight", ends: "both", line: "dashed" });
    expect(s).toEqual({ ...keep, fromEnd: "arrow", styleAttributes: { other: 1, pathfindingMethod: "direct", path: "long-dashed" } });
    const back = withArrowStyle(s, { route: "curved", ends: "none", line: "solid" });
    expect(back).toEqual({ ...keep, toEnd: "none" });
    expect(withArrowStyle(withArrowStyle(e, { route: "elbow" }), { route: "curved" })).toEqual(e);
    expect(withArrowStyle({ ...e, toEnd: "none" }, { ends: "end" })).toEqual(e);
  });
});
