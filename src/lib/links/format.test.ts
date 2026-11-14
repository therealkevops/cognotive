import { describe, expect, it } from "vitest";
import { relativePath } from "../vault/paths";
import { convertLinks, markdownLink, wikilink } from "./format";
import { Resolver } from "./resolve";

describe("link formats", () => {
  it("writes markdown links relative to the linking note", () => {
    expect(markdownLink("Projects/Plan.md", { path: "Garden ideas.md", target: "Garden ideas" })).toBe(
      "[Garden ideas](../Garden%20ideas.md)",
    );
    expect(markdownLink("Plan.md", { path: "Work/Notes.md", target: "Notes", sub: "Next steps" })).toBe(
      "[Notes › Next steps](Work/Notes.md#Next%20steps)",
    );
    expect(markdownLink("Plan.md", { path: "a/pic.png", target: "pic.png", embed: true })).toBe("![pic.png](a/pic.png)");
    expect(markdownLink("Plan.md", { path: null, target: "New idea", alias: "an idea" })).toBe("[an idea](New%20idea.md)");
    expect(markdownLink("Plan.md", { path: "B.md", target: "B", sub: "^abc" })).toBe("[B](B.md#^abc)");
  });

  it("writes wikilinks with the shortest link text", () => {
    expect(wikilink({ path: "Work/Notes.md", target: "x", sub: "H", alias: "see" }, "Notes")).toBe("[[Notes#H|see]]");
    expect(wikilink({ path: null, target: "New", embed: true })).toBe("![[New]]");
  });

  it("finds relative paths", () => {
    expect(relativePath("Projects", "Garden.md")).toBe("../Garden.md");
    expect(relativePath("", "Work/Notes.md")).toBe("Work/Notes.md");
    expect(relativePath("Work", "Work/Notes.md")).toBe("Notes.md");
    expect(relativePath("A/B", "A/C/D.md")).toBe("../C/D.md");
  });
});

describe("convertLinks", () => {
  const r = new Resolver(["Projects/Plan.md", "Garden.md", "Work/Notes.md", "pics/a.png"]);
  const resolve = (t: string) => r.resolve(t, "Projects/Plan.md");
  const linkText = (p: string) => r.linkText(p);
  const note = "See [[Garden]], [[Work/Notes#Next|next steps]], ![[a.png]], [[Missing]] and [[#Top]].";

  it("turns wikilinks into markdown links and back", () => {
    const md = convertLinks(note, "Projects/Plan.md", "markdown", resolve, linkText);
    expect(md).toBe(
      "See [Garden](../Garden.md), [next steps](../Work/Notes.md#Next), ![a.png](../pics/a.png), [Missing](Missing.md) and [[#Top]].",
    );
    // The markdown links resolve to the same files from the note's folder.
    expect(r.resolve("../Work/Notes.md", "Projects/Plan.md")).toBe("Work/Notes.md");
    const back = convertLinks(md, "Projects/Plan.md", "wikilink", resolve, linkText);
    expect(back).toBe("See [[Garden]], [[Notes#Next|next steps]], ![[a.png]], [[Missing]] and [[#Top]].");
  });

  it("leaves web links alone", () => {
    const t = "[site](https://example.com)";
    expect(convertLinks(t, "Plan.md", "wikilink", resolve, linkText)).toBe(t);
  });
});
