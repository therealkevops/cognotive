import { describe, expect, it } from "vitest";
import { Resolver } from "./resolve";

const r = new Resolver([
  "Note.md",
  "Projects/Note.md",
  "Projects/Deep/Plan.md",
  "Archive/Plan.md",
  "Unique.md",
  "Drawings/Map.excalidraw",
]);

describe("Resolver", () => {
  it("matches by name, case-insensitively", () => {
    expect(r.resolve("unique")).toBe("Unique.md");
    expect(r.resolve("Unique.md")).toBe("Unique.md");
    expect(r.resolve("Missing")).toBeNull();
  });

  it("prefers the linking note's folder, then the shortest path", () => {
    expect(r.resolve("Note", "Projects/Other.md")).toBe("Projects/Note.md");
    expect(r.resolve("Note", "Elsewhere/x.md")).toBe("Note.md");
    expect(r.resolve("Plan", "x.md")).toBe("Archive/Plan.md");
  });

  it("matches path suffixes", () => {
    expect(r.resolve("Deep/Plan")).toBe("Projects/Deep/Plan.md");
    expect(r.resolve("Projects/Note")).toBe("Projects/Note.md");
  });

  it("resolves non-note files by full name", () => {
    expect(r.resolve("Map.excalidraw")).toBe("Drawings/Map.excalidraw");
  });

  it("treats an empty target as the note itself", () => {
    expect(r.resolve("", "Unique.md")).toBe("Unique.md");
  });

  it("writes the shortest unambiguous link text", () => {
    expect(r.linkText("Unique.md")).toBe("Unique");
    expect(r.linkText("Projects/Note.md")).toBe("Projects/Note");
  });
});
