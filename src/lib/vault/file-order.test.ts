import { describe, expect, it } from "vitest";
import { applyOrder, orderAfterMove, placeNames } from "./file-order";
import { buildTree } from "./tree";

const tree = buildTree(
  ["A/one.md", "A/two.md", "A/three.md", "B/x.md", "alpha.md", "beta.md", "pic.png"].map((path) => ({ path, kind: "file" as const, mtime: 0 })),
);
const names = (t: ReturnType<typeof buildTree>, folder = "") => {
  const find = (n: typeof t): typeof t | undefined => (n.path === folder ? n : n.children.map(find).find(Boolean));
  return find(t)!.children.map((c) => c.name);
};

describe("applyOrder", () => {
  it("puts each folder's listed names first, in order, the rest after as usual", () => {
    expect(names(tree)).toEqual(["A", "B", "alpha", "beta", "pic.png"]);
    const t = applyOrder(tree, { "": ["pic.png", "B", "beta.md"], A: ["three.md", "one.md"] });
    expect(names(t)).toEqual(["pic.png", "B", "beta", "A", "alpha"]);
    expect(names(t, "A")).toEqual(["three", "one", "two"]);
    // Names that aren't there any more are passed over.
    expect(names(applyOrder(tree, { "": ["gone.md", "beta.md"] }))).toEqual(["beta", "A", "B", "alpha", "pic.png"]);
  });
});

describe("placeNames", () => {
  const list = ["a", "b", "c", "d"];
  it("puts the moving names before or after the anchor", () => {
    expect(placeNames(list, ["d"], "a", "before")).toEqual(["d", "a", "b", "c"]);
    expect(placeNames(list, ["a", "b"], "d", "after")).toEqual(["c", "d", "a", "b"]);
    expect(placeNames(list, ["a"], "c", "before")).toEqual(["b", "a", "c", "d"]);
    // From another folder: added in place.
    expect(placeNames(list, ["new"], "b", "after")).toEqual(["a", "b", "new", "c", "d"]);
    // Onto itself: nothing changes.
    expect(placeNames(list, ["b"], "b", "after")).toBe(list);
  });
});

describe("orderAfterMove", () => {
  const order = { "": ["beta.md", "A"], A: ["two.md", "one.md"], "A/Sub": ["z.md"] };
  it("keeps a renamed item's place", () => {
    expect(orderAfterMove(order, "beta.md", "gamma.md")).toEqual({ ...order, "": ["gamma.md", "A"] });
  });
  it("takes a moved item out of its old folder's list", () => {
    expect(orderAfterMove(order, "A/two.md", "B/two.md")).toEqual({ ...order, A: ["one.md"] });
  });
  it("carries a renamed folder's lists with it", () => {
    expect(orderAfterMove(order, "A", "Archive")).toEqual({ "": ["beta.md", "Archive"], Archive: ["two.md", "one.md"], "Archive/Sub": ["z.md"] });
  });
  it("is null when the order doesn't mention it", () => {
    expect(orderAfterMove(order, "pic.png", "img.png")).toBeNull();
  });
});
