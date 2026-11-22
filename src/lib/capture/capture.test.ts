import { describe, expect, it } from "vitest";
import { appendCapture, captureEntry, captureTime, fromShare, isEmpty } from "./capture";

describe("fromShare", () => {
  it("separates a link shared inside the text", () => {
    expect(fromShare({ title: "A great post", text: "Look at this https://example.com/post?x=1" })).toEqual({
      text: "Look at this",
      url: "https://example.com/post?x=1",
      title: "A great post",
    });
    expect(fromShare({ title: "Page", text: "Page", url: "https://e.com" })).toEqual({ text: "", url: "https://e.com", title: "Page" });
  });
  it("keeps plain text, and a title alone becomes the text", () => {
    expect(fromShare({ text: "  a quote  " })).toEqual({ text: "a quote" });
    expect(fromShare({ title: "Just a title" })).toEqual({ text: "Just a title" });
  });
});

describe("captureEntry", () => {
  it("writes the time, the link, the text and pictures as one list item", () => {
    expect(captureEntry({ text: "Call Ann" }, "09:05")).toBe("- 09:05 Call Ann");
    expect(captureEntry({ text: "Read later", url: "https://e.com/a b", title: "On [notes]" }, "14:00")).toBe(
      "- 14:00 [On \\[notes\\]](https://e.com/a%20b) Read later",
    );
    expect(captureEntry({ text: "Line one\nline two\n\nafter a gap", embeds: ["![[photo.jpg]]"] }, "18:30")).toBe(
      "- 18:30 Line one\n  line two\n\n  after a gap\n  ![[photo.jpg]]",
    );
    expect(captureEntry({ text: "", embeds: ["![[a.png]]"] }, "07:00")).toBe("- 07:00\n  ![[a.png]]");
  });
  it("formats the time", () => {
    expect(captureTime(new Date(2026, 10, 22, 7, 3))).toBe("07:03");
  });
  it("knows an empty capture", () => {
    expect(isEmpty({ text: "  " })).toBe(true);
    expect(isEmpty({ text: "", url: "https://e.com" })).toBe(false);
  });
});

describe("appendCapture", () => {
  it("starts a Captured section at the end", () => {
    expect(appendCapture("# 2026-11-22\n\nMorning plans.\n", "- 09:00 Idea")).toBe("# 2026-11-22\n\nMorning plans.\n\n## Captured\n\n- 09:00 Idea\n");
    expect(appendCapture("", "- 09:00 Idea")).toBe("## Captured\n\n- 09:00 Idea\n");
  });
  it("adds to an existing section, keeping the list together, even with other sections after it", () => {
    const one = appendCapture("# Day\n", "- 09:00 First");
    const two = appendCapture(one, "- 10:00 Second\n  more");
    expect(two).toBe("# Day\n\n## Captured\n\n- 09:00 First\n- 10:00 Second\n  more\n");
    const withAfter = "# Day\n\n## Captured\n\n- 09:00 First\n\n## Evening\n\nNotes.";
    expect(appendCapture(withAfter, "- 10:00 Second")).toBe("# Day\n\n## Captured\n\n- 09:00 First\n- 10:00 Second\n\n## Evening\n\nNotes.");
  });
});
