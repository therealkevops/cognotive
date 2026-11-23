import type { CanvasEdge } from "./format";

/*
 * How an arrow is drawn. JSON Canvas has the ends (fromEnd, toEnd); the line's route and
 * dashes are kept under "styleAttributes" as the Advanced Canvas plugin for Obsidian keeps
 * them (pathfindingMethod "direct" or "square"; path "dotted", "short-dashed" or
 * "long-dashed"), so an arrow styled here looks the same there.
 */

export type ArrowRoute = "curved" | "straight" | "elbow";
export type ArrowEnds = "none" | "end" | "both";
export type ArrowLine = "solid" | "dashed" | "dotted";

const styles = (e: CanvasEdge) =>
  (e.styleAttributes && typeof e.styleAttributes === "object" ? e.styleAttributes : {}) as Record<string, unknown>;

export function arrowRoute(e: CanvasEdge): ArrowRoute {
  const m = styles(e).pathfindingMethod;
  return m === "direct" ? "straight" : m === "square" ? "elbow" : "curved";
}

export function arrowEnds(e: CanvasEdge): ArrowEnds {
  const end = e.toEnd !== "none";
  const start = e.fromEnd === "arrow";
  return start && end ? "both" : end ? "end" : start ? "both" : "none";
}

export function arrowLine(e: CanvasEdge): ArrowLine {
  const p = styles(e).path;
  return p === "dotted" ? "dotted" : p === "short-dashed" || p === "long-dashed" ? "dashed" : "solid";
}

/** The SVG dash pattern for the line, if it isn't solid. */
export function dashPattern(e: CanvasEdge): string | undefined {
  const p = styles(e).path;
  return p === "dotted" ? "1 5" : p === "short-dashed" ? "4 4" : p === "long-dashed" ? "9 6" : undefined;
}

/** The arrow with a new route, ends or line; everything else on it is kept. */
export function withArrowStyle(e: CanvasEdge, change: { route?: ArrowRoute; ends?: ArrowEnds; line?: ArrowLine }): CanvasEdge {
  const out: CanvasEdge = { ...e };
  const s = { ...styles(e) };
  if (change.route) {
    if (change.route === "curved") delete s.pathfindingMethod;
    else s.pathfindingMethod = change.route === "straight" ? "direct" : "square";
  }
  if (change.line) {
    if (change.line === "solid") delete s.path;
    else s.path = change.line === "dotted" ? "dotted" : "long-dashed";
  }
  if (Object.keys(s).length) out.styleAttributes = s;
  else delete out.styleAttributes;
  if (change.ends) {
    delete out.fromEnd;
    delete out.toEnd;
    if (change.ends === "none") out.toEnd = "none";
    if (change.ends === "both") out.fromEnd = "arrow";
  }
  return out;
}
