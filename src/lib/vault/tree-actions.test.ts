import { describe, expect, it } from "vitest";
import { buildTree } from "./tree";
import { copyPath, moveTargets } from "./tree-actions";

describe("copyPath", () => {
  it("names a copy after the original, numbering further copies", () => {
    const taken = new Set(["Plan.md", "Notes/Plan copy.md"]);
    const has = (p: string) => taken.has(p);
    expect(copyPath("Plan.md", has)).toBe("Plan copy.md");
    expect(copyPath("Notes/Plan.md", has)).toBe("Notes/Plan copy 2.md");
    expect(copyPath("Board.canvas", has)).toBe("Board copy.canvas");
  });

  it("keeps a drawing's double extension whole", () => {
    expect(copyPath("Sketch.excalidraw.md", () => false)).toBe("Sketch copy.excalidraw.md");
  });
});

describe("moveTargets", () => {
  const entry = (path: string, kind: "file" | "folder" = "file") => ({ path, kind, mtime: 0 });
  const tree = buildTree([entry("Welcome.md"), entry("Work/Plan.md"), entry("Work/Old/Notes.md"), entry("Home", "folder")]);
  const ids = (path: string) => moveTargets(tree, path).map((t) => t.id);

  it("offers every other folder, and the top level for something inside one", () => {
    expect(ids("Welcome.md")).toEqual(["Home", "Work", "Work/Old"]);
    expect(ids("Work/Plan.md")).toEqual(["", "Home", "Work/Old"]);
  });

  it("never offers a folder itself or anything inside it", () => {
    expect(ids("Work")).toEqual(["Home"]);
  });
});
