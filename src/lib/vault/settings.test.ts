import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, formatDate, newNoteFromLink, parseSettings, serializeSettings } from "./settings";

const d = new Date(2026, 10, 4, 9, 5, 7); // Wed 4 Nov 2026, 09:05:07

describe("formatDate", () => {
  it("supports Moment-style tokens and [literals]", () => {
    expect(formatDate(d, "YYYY-MM-DD")).toBe("2026-11-04");
    expect(formatDate(d, "dddd D MMMM YY")).toBe("Wednesday 4 November 26");
    expect(formatDate(d, "ddd, MMM D [at] HH:mm:ss")).toBe("Wed, Nov 4 at 09:05:07");
  });
});

describe("parseSettings", () => {
  it("falls back to defaults for missing, wrong-typed or broken values", () => {
    expect(parseSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings("{oops")).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('{"dailyFolder": "Journal", "drawingSvgCopy": "yes"}')).toEqual({
      ...DEFAULT_SETTINGS,
      dailyFolder: "Journal",
    });
  });

  it("keeps only known property types", () => {
    expect(parseSettings('{"propertyTypes": {"priority": "number", "x": "colour", "y": 3}}').propertyTypes).toEqual({ priority: "number" });
  });

  it("keeps only strings in the health ignore list", () => {
    expect(parseSettings('{"healthIgnore": ["A.md", 3, null]}').healthIgnore).toEqual(["A.md"]);
    expect(parseSettings('{"healthIgnore": "A.md"}').healthIgnore).toEqual([]);
  });

  it("round-trips", () => {
    const s = { ...DEFAULT_SETTINGS, attachmentFolder: "files" };
    expect(parseSettings(serializeSettings(s))).toEqual(s);
  });
});

describe("newNoteFromLink", () => {
  const at = (newNoteLocation: "current" | "root" | "folder", newNoteFolder = "") => ({ newNoteLocation, newNoteFolder });
  it("puts the note in the linking note's folder by default", () => {
    expect(newNoteFromLink("Ideas", "Projects/Plan.md", at("current"))).toEqual({ folder: "Projects", name: "Ideas" });
    expect(newNoteFromLink("Ideas", "Plan.md", at("current"))).toEqual({ folder: "", name: "Ideas" });
    expect(newNoteFromLink("Ideas", null, at("current"))).toEqual({ folder: "", name: "Ideas" });
  });
  it("can use the vault root or a set folder", () => {
    expect(newNoteFromLink("Ideas.md", "Projects/Plan.md", at("root"))).toEqual({ folder: "", name: "Ideas" });
    expect(newNoteFromLink("Ideas", "Projects/Plan.md", at("folder", "/Inbox/"))).toEqual({ folder: "Inbox", name: "Ideas" });
  });
  it("keeps a folder written in the link", () => {
    expect(newNoteFromLink("Area/Sub/Ideas", "Projects/Plan.md", at("current"))).toEqual({ folder: "Area/Sub", name: "Ideas" });
  });
  it("defaults an unknown location to the current folder", () => {
    expect(parseSettings(JSON.stringify({ newNoteLocation: "elsewhere" })).newNoteLocation).toBe("current");
  });
});
