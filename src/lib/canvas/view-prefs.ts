import { readPref, writePref } from "../prefs";

/* How canvases are shown on this device: a preference, not part of any canvas file. */

export interface CanvasViewPrefs {
  grid: "dots" | "lines" | "none";
  snap: boolean;
  minimap: boolean;
  /** Cards with their contents, or just their titles. */
  cards: "preview" | "titles";
}

export const DEFAULT_CANVAS_VIEW: CanvasViewPrefs = { grid: "dots", snap: false, minimap: false, cards: "preview" };

/** Spacing of the grid and of snapping, in board units. */
export const GRID_GAP = 22;

const KEY = "canvasView";
export const CANVAS_VIEW_EVENT = "noted-canvas-view";

/** Any stored value made sound: unknown or missing fields take their defaults. */
export function cleanCanvasView(raw: unknown): CanvasViewPrefs {
  const v = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<keyof CanvasViewPrefs, unknown>>;
  const d = DEFAULT_CANVAS_VIEW;
  return {
    grid: v.grid === "dots" || v.grid === "lines" || v.grid === "none" ? v.grid : d.grid,
    snap: typeof v.snap === "boolean" ? v.snap : d.snap,
    minimap: typeof v.minimap === "boolean" ? v.minimap : d.minimap,
    cards: v.cards === "preview" || v.cards === "titles" ? v.cards : d.cards,
  };
}

export function loadCanvasView(): CanvasViewPrefs {
  return cleanCanvasView(readPref<unknown>(KEY, {}));
}

/** Saves it and tells other open canvases (a split view) to follow. */
export function saveCanvasView(v: CanvasViewPrefs): void {
  writePref(KEY, v);
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(CANVAS_VIEW_EVENT));
}
