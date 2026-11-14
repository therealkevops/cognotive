import { describe, expect, it } from "vitest";
import { maskCode, parseNote, splitLinkText } from "./parse";

describe("splitLinkText", () => {
  it("splits target, heading, block and alias", () => {
    expect(splitLinkText("Note")).toEqual({ target: "Note", alias: undefined });
    expect(splitLinkText("Folder/Note#Part two|see this")).toEqual({
      target: "Folder/Note",
      heading: "Part two",
      alias: "see this",
    });
    expect(splitLinkText("Note#^abc123")).toEqual({ target: "Note", block: "abc123", alias: undefined });
    expect(splitLinkText("#Local heading")).toEqual({ target: "", heading: "Local heading", alias: undefined });
    expect(splitLinkText("Note\\|in table")).toMatchObject({ target: "Note", alias: "in table" });
  });
});

describe("parseNote", () => {
  it("finds wikilinks, embeds and local markdown links with positions", () => {
    const md = "See [[Alpha]] and ![[Beta#Intro]].\n[x](Gamma%20Notes.md) [web](https://example.com)";
    const { links } = parseNote(md);
    expect(links.map((l) => [l.target, l.kind, l.embed, l.line])).toEqual([
      ["Alpha", "wikilink", false, 1],
      ["Beta", "wikilink", true, 1],
      ["Gamma Notes.md", "markdown", false, 2],
    ]);
    expect(md.slice(links[0].from, links[0].to)).toBe("[[Alpha]]");
    expect(links[1].heading).toBe("Intro");
  });

  it("ignores links in code", () => {
    const md = "`[[Not]]`\n```\n[[AlsoNot]]\n```\n[[Yes]]";
    expect(parseNote(md).links.map((l) => l.target)).toEqual(["Yes"]);
  });

  it("collects tags from the body and frontmatter, lower-cased", () => {
    const md = "---\ntags: [Project, area/work]\n---\n# Heading\nText #Idea and #area/home, not #123 or a#b.";
    expect(parseNote(md).tags).toEqual(["area/home", "area/work", "idea", "project"]);
  });

  it("parses properties and aliases, and survives bad YAML", () => {
    const ok = parseNote("---\nstatus: active\naliases: [AA, Double A]\n---\nbody");
    expect(ok.properties).toMatchObject({ status: "active" });
    expect(ok.aliases).toEqual(["AA", "Double A"]);
    const bad = parseNote("---\nkey: [unclosed\n---\nbody");
    expect(bad.propertiesError).toBe(true);
    expect(bad.properties).toEqual({});
  });

  it("keeps offsets when masking code", () => {
    const md = "a `b` c\n```\nx\n```\nd";
    expect(maskCode(md)).toHaveLength(md.length);
  });
});
