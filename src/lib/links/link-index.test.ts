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

  it("turns links to deleted notes into plain text", () => {
    const ix = vault();
    ix.set("Notes.md", "[[Garden#Beds]], [the garden](Garden.md) and ![[Garden]].");
    const out = ix.unlinkTo((p) => p === "Garden.md" || p === "Journal.md");
    expect(Object.fromEntries(out)).toEqual({
      "Home.md": "# Home\nSee Garden and [[Recipes/Pasta|pasta]].\nAlso [[Missing note]]. #index",
      "Recipes/Pasta.md": "Needs tomatoes from the garden. #food/italian\n",
      "Notes.md": "Garden › Beds, the garden and .",
    });
  });

  it("counts the notes linking to each file", () => {
    const counts = vault().inboundCounts();
    expect(counts.get("Garden.md")).toBe(3);
    expect(counts.get("Home.md")).toBe(1);
    expect(counts.has("Lonely.md")).toBe(false);
  });

  it("finds notes related through shared links", () => {
    const ix = new LinkIndex();
    ix.set("A.md", "[[Hub]] [[Tools]]");
    ix.set("B.md", "[[Hub]] [[Tools]] [[Other]]");
    ix.set("C.md", "[[Hub]]");
    ix.set("D.md", "[[A]] and [[E]]");
    ix.set("E.md", "nothing");
    ix.set("Hub.md", "");
    ix.set("Tools.md", "");
    // B shares two targets with A; C one; E is linked from the same note (D) as A.
    expect(ix.related("A.md").map((r) => [r.path, r.score])).toEqual([
      ["B.md", 2],
      ["C.md", 1],
      ["E.md", 1],
    ]);
    expect(ix.related("A.md")[0].via).toEqual(["Hub.md", "Tools.md"]);
    // Directly linked notes aren't "related": D links to A.
    expect(ix.related("A.md").some((r) => r.path === "D.md")).toBe(false);
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

  it("finds other notes' titles mentioned in a note, first mention of each", () => {
    const ix = new LinkIndex();
    ix.set("Beta.md", "Alpha, then gamma, then Alpha again. [[Delta]] is linked. `Gamma` in code.");
    ix.set("Alpha.md", "");
    ix.set("Gamma.md", "");
    ix.set("Delta.md", "");
    const m = ix.mentionsIn("Beta.md");
    expect(m.map((x) => [x.target, x.text, x.from])).toEqual([
      ["Alpha.md", "Alpha", 0],
      ["Gamma.md", "gamma", 12],
    ]);
    expect(ix.mentionsIn("Beta.md", 1)).toHaveLength(1);
    expect(ix.mentionsIn("Nope.md")).toEqual([]);
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

describe("canvases in the link index", () => {
  const board = (file: string) =>
    JSON.stringify({
      nodes: [
        { id: "a", type: "file", file, x: 0, y: 0, width: 10, height: 10 },
        { id: "b", type: "file", file: "Goal.md", x: 0, y: 0, width: 10, height: 10 },
        { id: "t", type: "text", text: "Remember [[Plan]]", x: 0, y: 0, width: 10, height: 10 },
      ],
      edges: [{ id: "e", fromNode: "a", toNode: "b", label: "supports" }],
    });

  it("counts cards and text links as backlinks, and labelled arrows as relations", () => {
    const ix = new LinkIndex();
    ix.set("Plan.md", "# Plan");
    ix.set("Goal.md", "# Goal");
    ix.set("Board.canvas", board("Plan.md"));
    expect(ix.backlinks("Plan.md").map((b) => [b.source, b.context])).toEqual([
      ["Board.canvas", "On the canvas"],
      ["Board.canvas", "On the canvas"],
    ]);
    expect(ix.canvasRelations("Plan.md")).toEqual([
      { canvas: "Board.canvas", other: "Goal.md", resolved: true, label: "supports", direction: "out" },
    ]);
    expect(ix.canvasRelations("Goal.md")[0]).toMatchObject({ other: "Plan.md", direction: "in", label: "supports" });
    expect(ix.graph().nodes.find((n) => n.id === "Board.canvas")?.kind).toBe("canvas");
  });

  it("follows renames in file cards and text cards", () => {
    const ix = new LinkIndex();
    ix.set("Plan.md", "# Plan");
    ix.set("Goal.md", "# Goal");
    ix.set("Board.canvas", board("Plan.md"));
    const before = ix.snapshotResolver();
    ix.remove("Plan.md");
    ix.set("Work/Roadmap.md", "# Plan");
    const out = ix.rewriteLinksTo("Plan.md", "Work/Roadmap.md", before);
    const updated = JSON.parse(out.get("Board.canvas")!);
    expect(updated.nodes[0].file).toBe("Work/Roadmap.md");
    expect(updated.nodes[2].text).toBe("Remember [[Roadmap]]");
  });
});
