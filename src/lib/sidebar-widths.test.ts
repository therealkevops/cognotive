import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_WIDTHS, MAX_WIDTH, MIN_MIDDLE, MIN_WIDTH, clampWidth, loadWidths, saveWidths } from "./sidebar-widths";

describe("sidebar widths", () => {
  beforeEach(() => localStorage.clear());

  it("keeps a width within its limits and leaves the middle room", () => {
    expect(clampWidth(100, 288, 1600)).toBe(MIN_WIDTH);
    expect(clampWidth(900, 288, 2400)).toBe(MAX_WIDTH);
    expect(clampWidth(350.4, 288, 1600)).toBe(350);
    expect(clampWidth(500, 300, 1100)).toBe(1100 - 300 - MIN_MIDDLE);
    // A window too narrow for both still gets the smallest sidebar.
    expect(clampWidth(500, 300, 700)).toBe(MIN_WIDTH);
  });

  it("starts at the defaults, and reads back what was saved (made sound)", () => {
    expect(loadWidths()).toEqual(DEFAULT_WIDTHS);
    saveWidths({ left: 320, right: 400 });
    expect(loadWidths()).toEqual({ left: 320, right: 400 });
    localStorage.setItem("noted-ai:sidebarWidths", JSON.stringify({ left: 9999, right: "wide" }));
    expect(loadWidths()).toEqual({ left: MAX_WIDTH, right: DEFAULT_WIDTHS.right });
  });
});
