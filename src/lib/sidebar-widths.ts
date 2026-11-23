import { readPref, writePref } from "./prefs";

/* How wide the sidebar and the context panel are, as the user dragged them (on this device). */

export interface SidebarWidths {
  left: number;
  right: number;
}

export const DEFAULT_WIDTHS: SidebarWidths = { left: 272, right: 288 };
export const MIN_WIDTH = 200;
export const MAX_WIDTH = 560;
/** The note in the middle keeps at least this much room. */
export const MIN_MIDDLE = 420;

/**
 * A width for one side within its limits, leaving the middle its room in a window this
 * wide (`other` is the other side's width, or the rail when it's collapsed).
 */
export function clampWidth(width: number, other: number, windowWidth: number): number {
  const room = windowWidth > 0 ? windowWidth - other - MIN_MIDDLE : MAX_WIDTH;
  return Math.round(Math.max(MIN_WIDTH, Math.min(width, MAX_WIDTH, room)));
}

export function loadWidths(): SidebarWidths {
  const raw = readPref<Partial<Record<keyof SidebarWidths, unknown>>>("sidebarWidths", {});
  const pick = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.max(MIN_WIDTH, Math.min(v, MAX_WIDTH)) : d);
  return { left: pick(raw?.left, DEFAULT_WIDTHS.left), right: pick(raw?.right, DEFAULT_WIDTHS.right) };
}

export function saveWidths(w: SidebarWidths): void {
  writePref("sidebarWidths", w);
}
