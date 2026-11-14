import { describe, expect, it } from "vitest";
import { extractHeadings } from "./outline";

describe("extractHeadings", () => {
  it("finds headings with levels and offsets, ignoring code fences and frontmatter", () => {
    const md = "---\ntitle: x\n---\n# One\ntext\n```\n# not a heading\n```\n## Two ##\n#nope";
    const hs = extractHeadings(md);
    expect(hs.map((h) => [h.level, h.text])).toEqual([
      [1, "One"],
      [2, "Two"],
    ]);
    expect(md.slice(hs[1].offset).startsWith("## Two")).toBe(true);
  });
});
