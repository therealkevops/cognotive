import { describe, expect, it } from "vitest";
import { setFrontmatterProperty, splitFrontmatter } from "./frontmatter";

describe("setFrontmatterProperty", () => {
  it("adds frontmatter, or a property to existing frontmatter", () => {
    expect(setFrontmatterProperty("# Hi\n", "hub", true)).toBe("---\nhub: true\n---\n# Hi\n");
    expect(setFrontmatterProperty("---\ntags: [a]\n---\n# Hi\n", "hub", true)).toBe("---\ntags: [a]\nhub: true\n---\n# Hi\n");
  });

  it("replaces a value, including a list under it, and keeps other lines", () => {
    const md = "---\nhub:\n  - x\ntitle: T\n---\nbody";
    expect(setFrontmatterProperty(md, "hub", false)).toBe("---\nhub: false\ntitle: T\n---\nbody");
  });

  it("removes a property, and empty frontmatter with it", () => {
    expect(setFrontmatterProperty("---\nhub: true\ntags: [a]\n---\nbody", "hub", undefined)).toBe("---\ntags: [a]\n---\nbody");
    expect(setFrontmatterProperty("---\nhub: true\n---\nbody", "hub", undefined)).toBe("body");
    expect(setFrontmatterProperty("body", "hub", undefined)).toBe("body");
  });

  it("keeps splitFrontmatter working", () => {
    expect(splitFrontmatter("---\na: 1\n---\nx").body).toBe("x");
  });
});
