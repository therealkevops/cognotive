import { describe, expect, it } from "vitest";
import {
  basename,
  dirname,
  extname,
  isWithin,
  joinPath,
  noteTitle,
  normalizePath,
  uniquePath,
  validateName,
} from "./paths";

describe("normalizePath", () => {
  it("collapses slashes and trims segments", () => {
    expect(normalizePath("/a//b/ c.md/")).toBe("a/b/c.md");
  });
  it("drops . segments", () => {
    expect(normalizePath("./a/./b")).toBe("a/b");
  });
  it("rejects ..", () => {
    expect(() => normalizePath("a/../b")).toThrow();
  });
});

describe("path parts", () => {
  it("splits names and folders", () => {
    expect(basename("a/b/Note.md")).toBe("Note.md");
    expect(dirname("a/b/Note.md")).toBe("a/b");
    expect(dirname("Note.md")).toBe("");
    expect(extname("a/Note.MD")).toBe(".md");
    expect(extname(".hidden")).toBe("");
    expect(joinPath("", "a", "b.md")).toBe("a/b.md");
    expect(noteTitle("a/My Note.md")).toBe("My Note");
    expect(noteTitle("a/drawing.excalidraw")).toBe("drawing.excalidraw");
  });
});

describe("isWithin", () => {
  it("matches the folder and its descendants but not siblings with a shared prefix", () => {
    expect(isWithin("a", "a")).toBe(true);
    expect(isWithin("a/b.md", "a")).toBe(true);
    expect(isWithin("ab/c.md", "a")).toBe(false);
    expect(isWithin("anything", "")).toBe(true);
  });
});

describe("validateName", () => {
  it("accepts ordinary names", () => {
    expect(validateName("Meeting notes 2026-11-14")).toBeNull();
  });
  it.each(["", "  ", "a/b", ".hidden", "what?", "a#b", "[x]"])("rejects %j", (name) => {
    expect(validateName(name)).not.toBeNull();
  });
});

describe("uniquePath", () => {
  it("returns the desired path when free", () => {
    expect(uniquePath("Untitled.md", () => false)).toBe("Untitled.md");
  });
  it("adds the first free number", () => {
    const taken = new Set(["f/Untitled.md", "f/Untitled 1.md"]);
    expect(uniquePath("f/Untitled.md", (p) => taken.has(p))).toBe("f/Untitled 2.md");
  });
  it("works for folders (no extension)", () => {
    expect(uniquePath("New folder", (p) => p === "New folder")).toBe("New folder 1");
  });
});
