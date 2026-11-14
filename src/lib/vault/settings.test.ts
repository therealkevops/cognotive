import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, fillTemplate, formatDate, parseSettings, serializeSettings } from "./settings";

const d = new Date(2026, 10, 4, 9, 5, 7); // Wed 4 Nov 2026, 09:05:07

describe("formatDate", () => {
  it("supports Moment-style tokens and [literals]", () => {
    expect(formatDate(d, "YYYY-MM-DD")).toBe("2026-11-04");
    expect(formatDate(d, "dddd D MMMM YY")).toBe("Wednesday 4 November 26");
    expect(formatDate(d, "ddd, MMM D [at] HH:mm:ss")).toBe("Wed, Nov 4 at 09:05:07");
  });
});

describe("fillTemplate", () => {
  it("fills title, date and time, with optional formats", () => {
    expect(fillTemplate("# {{title}}\n{{date}} {{time}} {{date:dddd}}", { title: "Plan", now: d })).toBe(
      "# Plan\n2026-11-04 09:05 Wednesday",
    );
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

  it("round-trips", () => {
    const s = { ...DEFAULT_SETTINGS, attachmentFolder: "files" };
    expect(parseSettings(serializeSettings(s))).toEqual(s);
  });
});
