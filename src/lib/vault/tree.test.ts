import { describe, expect, it } from "vitest";
import { buildTree, type TreeNode } from "./tree";

const shape = (n: TreeNode): unknown =>
  n.kind === "file" ? n.name : { [n.name || "/"]: n.children.map(shape) };

describe("buildTree", () => {
  it("creates implied folders, keeps empty ones, and sorts folders first, naturally", () => {
    const tree = buildTree([
      { path: "b.md", kind: "file", mtime: 0 },
      { path: "Note 10.md", kind: "file", mtime: 0 },
      { path: "Note 2.md", kind: "file", mtime: 0 },
      { path: "Projects/x/deep.md", kind: "file", mtime: 0 },
      { path: "Empty", kind: "folder", mtime: 0 },
      { path: "a.png", kind: "file", mtime: 0 },
    ]);
    expect(shape(tree)).toEqual({
      "/": [
        { Empty: [] },
        { Projects: [{ x: ["deep"] }] },
        "a.png",
        "b",
        "Note 2",
        "Note 10",
      ],
    });
  });
});
