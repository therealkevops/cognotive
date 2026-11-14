import { describe, expect, it } from "vitest";
import { LinkIndex } from "./link-index";

function vault() {
  const ix = new LinkIndex();
  ix.set("Home.md", "# Home\nSee [[Garden]] and [[Recipes/Pasta|pasta]].\nAlso [[Missing note]]. #index");
  ix.set("Garden.md", "---\naliases: [Allotment]\ntags: [outdoors]\n---\nTomatoes. Back to [[Home]].");
  ix.set("Recipes/Pasta.md", "Needs tomatoes from the garden. #food/italian\n![[Garden#Tomatoes]]");
  ix.set("Journal.md", "Went to the Garden today, then the allotment. [[Garden]] later. `Garden` in code.");
  ix.set("Lonely.md", "No links here.");
  return ix;
}

describe("LinkIndex", () => {
  it("resolves outgoing links", () => {
    const out = vault().outgoing("Home.md");
    expect(out.map((o) => o.resolved)).toEqual(["Garden.md", "Recipes/Pasta.md", null]);
  });

  it("lists backlinks with their line for context", () => {
    const bl = vault().backlinks("Garden.md");
    expect(bl.map((b) => b.source)).toEqual(["Home.md", "Journal.md", "Recipes/Pasta.md"]);
    expect(bl[0].context).toBe("See [[Garden]] and [[Recipes/Pasta|pasta]].");
    expect(bl[2].link.embed).toBe(true);
  });

  it("lists unresolved links by target", () => {
    expect([...vault().unresolved()]).toEqual([["Missing note", ["Home.md"]]]);
  });

  it("finds unlinked mentions of the title and aliases, not inside links or code", () => {
    const m = vault().unlinkedMentions("Garden.md");
    expect(m.map((x) => [x.source, x.text])).toEqual([
      ["Journal.md", "Garden"],
      ["Journal.md", "allotment"],
      ["Recipes/Pasta.md", "garden"],
    ]);
  });

  it("counts tags, including parents of nested tags", () => {
    const tags = vault().tags();
    expect(Object.fromEntries(tags)).toEqual({ index: 1, outdoors: 1, food: 1, "food/italian": 1 });
    expect(vault().withTag("food")).toEqual(["Recipes/Pasta.md"]);
  });

  it("builds a deduplicated graph, with optional ghost nodes", () => {
    const g = vault().graph();
    expect(g.nodes).toHaveLength(5);
    expect(g.edges).toContainEqual({ source: "Journal.md", target: "Garden.md" });
    expect(g.edges.filter((e) => e.source === "Journal.md")).toHaveLength(1);
    const withGhosts = vault().graph({ includeUnresolved: true });
    expect(withGhosts.nodes.find((n) => n.unresolved)?.title).toBe("Missing note");
  });

  it("finds neighbourhoods and orphans", () => {
    const ix = vault();
    expect(ix.neighborhood("Recipes/Pasta.md", 1).nodes.map((n) => n.id).sort()).toEqual([
      "Garden.md",
      "Home.md",
      "Recipes/Pasta.md",
    ]);
    expect(ix.orphans()).toEqual(["Lonely.md"]);
  });

  it("rewrites links after a rename, keeping headings and aliases", () => {
    const ix = vault();
    const before = ix.snapshotResolver();
    const garden = ix.content("Garden.md")!;
    ix.remove("Garden.md");
    ix.set("Outdoors/Veg Garden.md", garden);
    const updates = ix.rewriteLinksTo("Garden.md", "Outdoors/Veg Garden.md", before);
    expect(updates.get("Home.md")).toContain("See [[Veg Garden]] and");
    expect(updates.get("Recipes/Pasta.md")).toContain("![[Veg Garden#Tomatoes]]");
    expect(updates.get("Journal.md")).toContain("[[Veg Garden]] later");
    expect(updates.has("Lonely.md")).toBe(false);
  });

  it("rewrites markdown links to the new path", () => {
    const ix = new LinkIndex();
    ix.set("a.md", "[the plan](Old%20Plan.md#Step)");
    ix.set("Old Plan.md", "x");
    const before = ix.snapshotResolver();
    ix.remove("Old Plan.md");
    ix.set("Plans/New Plan.md", "x");
    expect(ix.rewriteLinksTo("Old Plan.md", "Plans/New Plan.md", before).get("a.md")).toBe(
      "[the plan](Plans/New%20Plan.md#Step)",
    );
  });

  it("treats drawings as graph nodes whose links count as backlinks", () => {
    const ix = vault();
    ix.set(
      "Drawings/Layout.excalidraw",
      JSON.stringify({ elements: [{ type: "rectangle", link: "[[Garden]]" }, { type: "text", text: "[[Home]]" }] }),
    );
    const bl = ix.backlinks("Garden.md").find((b) => b.source === "Drawings/Layout.excalidraw");
    expect(bl?.context).toBe("Linked from the drawing");
    const node = ix.graph().nodes.find((n) => n.id === "Drawings/Layout.excalidraw");
    expect(node).toMatchObject({ kind: "drawing", title: "Layout", degree: 2 });
    expect(ix.resolve("Layout.excalidraw")).toBe("Drawings/Layout.excalidraw");
  });

  it("rewrites links inside drawings on rename", () => {
    const ix = vault();
    ix.set("D.excalidraw", JSON.stringify({ elements: [{ type: "rectangle", link: "[[Garden]]" }] }));
    const before = ix.snapshotResolver();
    const garden = ix.content("Garden.md")!;
    ix.remove("Garden.md");
    ix.set("Plot.md", garden);
    const updated = ix.rewriteLinksTo("Garden.md", "Plot.md", before).get("D.excalidraw");
    expect(JSON.parse(updated!).elements[0].link).toBe("[[Plot]]");
  });
});
