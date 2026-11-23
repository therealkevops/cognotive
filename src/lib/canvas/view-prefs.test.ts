import { beforeEach, describe, expect, it, vi } from "vitest";
import { CANVAS_VIEW_EVENT, DEFAULT_CANVAS_VIEW, cleanCanvasView, loadCanvasView, saveCanvasView } from "./view-prefs";

describe("canvas view preferences", () => {
  beforeEach(() => localStorage.clear());

  it("defaults to a dot grid, no snapping, no mini-map and previews", () => {
    expect(loadCanvasView()).toEqual(DEFAULT_CANVAS_VIEW);
  });

  it("keeps sound values and replaces odd ones", () => {
    expect(cleanCanvasView({ grid: "lines", snap: true, minimap: "yes", cards: "huge" })).toEqual({
      grid: "lines",
      snap: true,
      minimap: false,
      cards: "preview",
      noteLinks: true,
    });
    expect(cleanCanvasView(null)).toEqual(DEFAULT_CANVAS_VIEW);
  });

  it("saves, reads back and tells open canvases", () => {
    const heard = vi.fn();
    window.addEventListener(CANVAS_VIEW_EVENT, heard);
    saveCanvasView({ grid: "none", snap: true, minimap: true, cards: "titles", noteLinks: false });
    expect(loadCanvasView()).toEqual({ grid: "none", snap: true, minimap: true, cards: "titles", noteLinks: false });
    expect(heard).toHaveBeenCalledOnce();
    window.removeEventListener(CANVAS_VIEW_EVENT, heard);
  });
});
