import { describe, expect, it } from "vitest";
import { completeWikilink, newNoteName, openWikilink, textLinkUpdates } from "./links";

describe("textLinkUpdates", () => {
  it("links text elements to the first note they mention", () => {
    const updates = textLinkUpdates([
      { id: "a", type: "text", text: "See [[Garden]] and [[Shed]]", link: null },
      { id: "b", type: "text", text: "no links", link: null },
      { id: "c", type: "rectangle", link: null },
      { id: "d", type: "text", text: "[[Tools|the tools]]", link: "[[Old]]" },
      { id: "e", type: "text", text: "[[Garden]]", link: "[[Garden]]" },
      { id: "f", type: "text", text: "[[Garden]]", link: "https://example.com" },
      { id: "g", type: "text", text: "[[Garden]]", link: null, isDeleted: true },
    ]);
    expect(Object.fromEntries(updates)).toEqual({ a: "[[Garden]]", d: "[[Tools|the tools]]" });
  });
});

describe("openWikilink", () => {
  it("finds an unfinished link before the caret", () => {
    expect(openWikilink("See [[Gar", 9)).toEqual({ start: 6, query: "Gar" });
    expect(openWikilink("See [[", 6)).toEqual({ start: 6, query: "" });
  });
  it("ignores finished links, aliases and other lines", () => {
    expect(openWikilink("See [[Garden]] now", 18)).toBeNull();
    expect(openWikilink("[[Garden|al", 11)).toBeNull();
    expect(openWikilink("[[Gar\nden", 9)).toBeNull();
    expect(openWikilink("plain", 5)).toBeNull();
  });
});

describe("completeWikilink", () => {
  it("inserts the link text and closing brackets", () => {
    expect(completeWikilink("See [[Gar", 6, 9, "Garden")).toEqual({ text: "See [[Garden]]", caret: 14 });
  });
  it("doesn't double existing closing brackets", () => {
    expect(completeWikilink("See [[Gar]] x", 6, 9, "Garden")).toEqual({ text: "See [[Garden]] x", caret: 14 });
  });
});

describe("newNoteName", () => {
  const notes = [{ title: "Welcome", linkText: "Welcome" }, { title: "Plan", linkText: "work/Plan" }];
  it("offers the query when no note has that name", () => {
    expect(newNoteName(" Ideas ", notes)).toBe("Ideas");
    expect(newNoteName("welcome", notes)).toBeNull();
    expect(newNoteName("work/plan", notes)).toBeNull();
    expect(newNoteName("  ", notes)).toBeNull();
  });
});
