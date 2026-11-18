import { describe, expect, it } from "vitest";
import { appendText, lineDiff, notePathFrom, rebase, replaceOnce } from "./proposals";
import { runTool, type ProposalSink } from "./tools";
import { testEnv } from "./tools.test";
import type { Proposal } from "./proposals";

describe("lineDiff", () => {
  it("marks added and removed lines, folding unchanged runs", () => {
    const before = ["a", "b", "c", "d", "e", "f", "g", "h"].join("\n");
    const after = ["a", "b", "c", "d", "E", "f", "g", "h"].join("\n");
    expect(lineDiff(before, after, 1)).toEqual([
      { kind: "skip", count: 3 },
      { kind: "same", text: "d" },
      { kind: "del", text: "e" },
      { kind: "add", text: "E" },
      { kind: "same", text: "f" },
      { kind: "skip", count: 2 },
    ]);
    expect(lineDiff("", "new\nnote")).toEqual([
      { kind: "add", text: "new" },
      { kind: "add", text: "note" },
    ]);
  });
});

describe("rebase", () => {
  const p = { before: "# Title\n\nOne\n\nTwo\n", after: "# Title\n\nOne\n\nTwo\n\nThree\n" };
  it("applies as proposed when nothing changed", () => {
    expect(rebase(p, p.before)).toBe(p.after);
  });
  it("keeps edits made since, elsewhere in the note", () => {
    expect(rebase(p, "# New title\n\nOne\n\nTwo\n")).toBe("# New title\n\nOne\n\nTwo\n\nThree\n");
  });
  it("refuses when the same lines changed, the note is gone, or a new note now exists", () => {
    expect(rebase({ before: "a\nb\nc", after: "a\nB!\nc" }, "a\nb changed\nc")).toBeNull();
    expect(rebase(p, undefined)).toBeNull();
    expect(rebase({ before: null, after: "x" }, "already here")).toBeNull();
    expect(rebase({ before: null, after: "x" }, undefined)).toBe("x");
  });
});

describe("text builders", () => {
  it("append at the end or under a heading", () => {
    expect(appendText("# A\n\ntext\n\n\n", "more")).toBe("# A\n\ntext\n\nmore\n");
    expect(appendText("", "first")).toBe("first\n");
    const doc = "# A\n\n## Ideas\n\n- one\n\n## Later\n\nstuff";
    expect(appendText(doc, "- two", "Ideas")).toBe("# A\n\n## Ideas\n\n- one\n\n- two\n\n## Later\n\nstuff");
    expect(appendText(doc, "x", "Missing")).toBeNull();
  });
  it("replace text that appears once", () => {
    expect(replaceOnce("a b c", "b", "B")).toEqual({ text: "a B c" });
    expect(replaceOnce("a b b", "b", "B")).toHaveProperty("error");
    expect(replaceOnce("a", "z", "B")).toHaveProperty("error");
  });
  it("make note paths", () => {
    expect(notePathFrom("/Projects//Plan/")).toBe("Projects/Plan.md");
    expect(notePathFrom("Plan.md")).toBe("Plan.md");
  });
});

describe("write tools", () => {
  const files: Record<string, string> = {
    "Cooking.md": "---\nhub: true\n---\n# Cooking\n\n## Notes\n\n- [[Bread]]\n",
    "Bread.md": "# Bread\n\nSourdough. Goes well with Soup.\n",
    "Soup.md": "# Soup\n\nLentils.\n",
  };
  const make = () => {
    const env = testEnv(files);
    const made: Proposal[] = [];
    const pending = (path: string) => made.filter((p) => p.path === path && p.kind !== "property").at(-1)?.after;
    const sink: ProposalSink = {
      linkFormat: "wikilink",
      textOf: (path) => pending(path) ?? files[path],
      exists: (path) => path in files || pending(path) !== undefined,
      add: (p) => {
        const full = { ...p, id: `p${made.length}`, status: "pending" as const };
        made.push(full);
        return full;
      },
    };
    return { env: { ...env, proposals: sink }, made };
  };

  it("aren't available without a sink", () => {
    expect(runTool(testEnv(files), "create_note", JSON.stringify({ path: "X", content: "x" })).content).toContain("no tool");
  });

  it("propose new notes, with properties, but never over an existing one", () => {
    const { env, made } = make();
    const r = runTool(env, "create_note", JSON.stringify({ path: "Recipes/Stew", content: "# Stew", properties: { tags: ["food"] } }));
    expect(r.content).toContain("Proposed (p0)");
    expect(made[0]).toMatchObject({ kind: "create", path: "Recipes/Stew.md", before: null, after: "---\ntags: [food]\n---\n# Stew\n" });
    expect(runTool(env, "create_note", JSON.stringify({ path: "Bread", content: "x" })).content).toContain("already exists");
    expect(runTool(env, "create_note", JSON.stringify({ path: "Recipes/Stew", content: "x" })).content).toContain("already exists");
    expect(runTool(env, "create_note", JSON.stringify({ path: "Bad#name", content: "x" })).content).toContain("Can't use");
  });

  it("propose appends and edits on top of earlier proposals", () => {
    const { env, made } = make();
    runTool(env, "append_to_note", JSON.stringify({ path: "Bread", text: "Bake at 230°C." }));
    runTool(env, "edit_note", JSON.stringify({ path: "Bread", find: "Sourdough.", replace: "Sourdough bread." }));
    expect(made[1].before).toBe(made[0].after);
    expect(made[1].after).toBe("# Bread\n\nSourdough bread. Goes well with Soup.\n\nBake at 230°C.\n");
    expect(runTool(env, "edit_note", JSON.stringify({ path: "Bread", find: "Rye", replace: "x" })).content).toContain("isn't in the note");
  });

  it("propose properties for any file", () => {
    const { env, made } = make();
    runTool(env, "set_property", JSON.stringify({ path: "Soup", key: "status", value: "draft" }));
    expect(made[0]).toMatchObject({ kind: "property", property: { key: "status", value: "draft", old: undefined }, before: "", after: "status: draft" });
    runTool(env, "set_property", JSON.stringify({ path: "Cooking", key: "hub", value: null }));
    expect(made[1].summary).toBe("Remove hub from Cooking");
  });

  it("propose links: a mention becomes a link, otherwise a hub lists it", () => {
    const { env, made } = make();
    runTool(env, "add_link", JSON.stringify({ from: "Bread", to: "Soup" }));
    expect(made[0].after).toBe("# Bread\n\nSourdough. Goes well with [[Soup]].\n");
    runTool(env, "add_link", JSON.stringify({ from: "Cooking", to: "Soup" }));
    expect(made[1].after).toContain("- [[Bread]]\n- [[Soup]]");
  });
});
