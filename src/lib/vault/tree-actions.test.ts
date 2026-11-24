import { describe, expect, it } from "vitest";
import { buildTree } from "./tree";
import { copyPath, moveTargets, moveTargetsFor, planCopy, rangeOf, topmost, visiblePaths } from "./tree-actions";

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

describe("choosing several items", () => {
  const tree = buildTree(
    ["A/one.md", "A/two.md", "A/Sub/three.md", "B/four.md", "five.md"].map((path) => ({ path, kind: "file" as const, mtime: 0 })),
  );

  it("lists the rows as shown, inside open folders only", () => {
    expect(visiblePaths(tree, new Set(["A"]))).toEqual(["A", "A/Sub", "A/one.md", "A/two.md", "B", "five.md"]);
    expect(visiblePaths(tree, new Set())).toEqual(["A", "B", "five.md"]);
  });

  it("takes a range either way round", () => {
    const order = ["A", "A/Sub", "A/one.md", "A/two.md", "B", "five.md"];
    expect(rangeOf(order, "A/one.md", "B")).toEqual(["A/one.md", "A/two.md", "B"]);
    expect(rangeOf(order, "B", "A/one.md")).toEqual(["A/one.md", "A/two.md", "B"]);
    expect(rangeOf(order, null, "B")).toEqual(["B"]);
    expect(rangeOf(order, "gone.md", "B")).toEqual(["B"]);
  });

  it("moves a folder rather than what's inside it", () => {
    expect(topmost(["A", "A/one.md", "A/Sub/three.md", "five.md"])).toEqual(["A", "five.md"]);
  });

  it("offers folders all of them can go to", () => {
    expect(moveTargetsFor(tree, ["A/one.md", "A/two.md"]).map((t) => t.id)).toEqual(["", "A/Sub", "B"]);
    // Both already at the top level: not offered.
    expect(moveTargetsFor(tree, ["A", "five.md"]).map((t) => t.id)).toEqual(["B"]);
    expect(moveTargetsFor(tree, ["five.md", "B/four.md"]).map((t) => t.id)).toEqual(["", "A", "A/Sub", "B"]);
  });
});

describe("planCopy", () => {
  const entries = [
    { path: "Notes/Plan.md", kind: "file" as const },
    { path: "Notes/Ideas.md", kind: "file" as const },
    { path: "Notes/Sub/Deep.md", kind: "file" as const },
    { path: "Notes/Empty", kind: "folder" as const },
    { path: "Archive/Plan.md", kind: "file" as const },
    { path: "pic.png", kind: "file" as const },
  ];

  it("copies files under their own names, or as copies where taken", () => {
    expect(planCopy([{ path: "Notes/Plan.md", isFolder: false }, { path: "Notes/Ideas.md", isFolder: false }, { path: "pic.png", isFolder: false }], "Archive", entries)).toEqual([
      { from: "Notes/Plan.md", to: "Archive/Plan copy.md", kind: "file" },
      { from: "Notes/Ideas.md", to: "Archive/Ideas.md", kind: "file" },
      { from: "pic.png", to: "Archive/pic.png", kind: "file" },
    ]);
  });

  it("duplicates in the same folder", () => {
    expect(planCopy([{ path: "Notes/Plan.md", isFolder: false }], "Notes", entries)).toEqual([
      { from: "Notes/Plan.md", to: "Notes/Plan copy.md", kind: "file" },
    ]);
  });

  it("copies a folder with everything in it, and what's inside a chosen folder once", () => {
    expect(planCopy([{ path: "Notes", isFolder: true }, { path: "Notes/Plan.md", isFolder: false }], "", entries)).toEqual([
      { from: "Notes", to: "Notes copy", kind: "folder" },
      { from: "Notes/Plan.md", to: "Notes copy/Plan.md", kind: "file" },
      { from: "Notes/Ideas.md", to: "Notes copy/Ideas.md", kind: "file" },
      { from: "Notes/Sub/Deep.md", to: "Notes copy/Sub/Deep.md", kind: "file" },
      { from: "Notes/Empty", to: "Notes copy/Empty", kind: "folder" },
    ]);
  });

  it("gives two copies with the same name different names", () => {
    expect(planCopy([{ path: "Notes/Plan.md", isFolder: false }, { path: "Archive/Plan.md", isFolder: false }], "", entries).map((p) => p.to)).toEqual([
      "Plan.md",
      "Plan copy.md",
    ]);
  });
});
