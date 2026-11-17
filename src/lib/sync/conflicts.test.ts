import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { ConflictStore, resolveBlocks, reviewBlocks } from "./conflicts";
import { mergeTheirs } from "./engine";

describe("reviewBlocks", () => {
  const base = "# Plan\n\nstart\n\nmiddle\n\nend";
  const ours = "# Plan\n\nstart (mine)\n\nmiddle\n\nend";
  const theirs = "# Plan!\n\nstart (theirs)\n\nmiddle\n\nend";
  const current = mergeTheirs(ours, base, theirs);

  it("shows only where both sides changed the same lines", () => {
    const blocks = reviewBlocks({ ours, base }, current);
    expect(blocks.filter((b) => b.kind === "conflict")).toEqual([
      { kind: "conflict", yours: ["start (mine)"], current: ["start (theirs)"] },
    ]);
    // Their heading change merged cleanly, so it's part of the note either way.
    expect(resolveBlocks(blocks, ["yours"])).toBe("# Plan!\n\nstart (mine)\n\nmiddle\n\nend");
    expect(resolveBlocks(blocks, ["current"])).toBe(current);
    expect(resolveBlocks(blocks, ["both"])).toBe("# Plan!\n\nstart (mine)\nstart (theirs)\n\nmiddle\n\nend");
  });

  it("has nothing left to review once the note matches either side there", () => {
    const fixed = current.replace("start (theirs)", "start (mine)");
    expect(reviewBlocks({ ours, base }, fixed).some((b) => b.kind === "conflict")).toBe(false);
  });

  it("treats a note created on both sides as one conflict", () => {
    const blocks = reviewBlocks({ ours: "local", base: "" }, "remote");
    expect(blocks).toEqual([{ kind: "conflict", yours: ["local"], current: ["remote"] }]);
  });
});

describe("ConflictStore", () => {
  it("keeps, renames and removes conflicts per repository", async () => {
    const store = new ConflictStore("t1");
    await store.add([{ path: "a.md", ours: "x", theirs: "y", base: "", kind: "text", at: 2 }]);
    await store.add([{ path: "b.png", ours: new Uint8Array([1]), theirs: new Uint8Array([2]), kind: "file", at: 1 }]);
    expect((await store.list()).map((c) => c.path)).toEqual(["b.png", "a.md"]);
    await store.rename("a.md", "Notes/a.md");
    const [, a] = await store.list();
    expect(a.path).toBe("Notes/a.md");
    await store.remove(a.id);
    expect((await store.list()).map((c) => c.path)).toEqual(["b.png"]);
    expect((await new ConflictStore("t2").list())).toEqual([]);
  });
});
