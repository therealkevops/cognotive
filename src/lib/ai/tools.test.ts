import { describe, expect, it } from "vitest";
import { LinkIndex } from "../links/link-index";
import { NoteIndex } from "../search/note-index";
import { findFile, READ_TOOLS, runTool, type ToolEnv } from "./tools";

export function testEnv(files: Record<string, string>): ToolEnv {
  const links = new LinkIndex();
  const search = new NoteIndex();
  for (const [p, c] of Object.entries(files)) {
    links.set(p, c);
    if (p.endsWith(".md")) search.set(p, c);
  }
  return { links, search, files: () => Object.keys(files), mtime: () => Date.now() };
}

const env = testEnv({
  "Cooking.md": "---\nhub: true\ntags: [food]\n---\n# Cooking\n\n- [[Bread]]\n- [[Soup]]\n",
  "Recipes/Bread.md": "---\nstatus: draft\n---\n# Bread\n\nSourdough needs a starter. See [[Cooking]].\n\n## Starter\n\nFlour and water, fed daily.\n",
  "Recipes/Soup.md": "# Soup\n\nLentil soup with #food tag. Mentions Bread without linking.\n",
  "Garden.md": "# Garden\n\nTomatoes and [[Compost]].\n",
});
const run = (name: string, args: unknown) => runTool(env, name, JSON.stringify(args));

describe("read tools", () => {
  it("are described for the model", () => {
    expect(READ_TOOLS.map((t) => t.function.name)).toContain("search_notes");
    for (const t of READ_TOOLS) expect(t.function.parameters.type).toBe("object");
  });

  it("find files from names, paths and links", () => {
    expect(findFile(env, "Bread")).toBe("Recipes/Bread.md");
    expect(findFile(env, "Recipes/Bread.md")).toBe("Recipes/Bread.md");
    expect(findFile(env, "[[Soup]]")).toBe("Recipes/Soup.md");
    expect(findFile(env, "Nope")).toBeNull();
  });

  it("search, with tag and property filters", () => {
    const r = run("search_notes", { query: "sourdough" });
    expect(JSON.parse(r.content).results[0].path).toBe("Recipes/Bread.md");
    expect(r.label).toBe("Searched “sourdough”");
    expect(r.read).toEqual([]);
    expect(JSON.parse(run("search_notes", { query: "tag:food" }).content).results.map((x: { path: string }) => x.path).sort()).toEqual([
      "Cooking.md",
      "Recipes/Soup.md",
    ]);
    expect(JSON.parse(run("search_notes", { query: "[status:draft]" }).content).results[0].path).toBe("Recipes/Bread.md");
    expect(run("search_notes", { query: "zebra" }).content).toContain("No notes match");
  });

  it("read a note or one section, and count it as read", () => {
    const r = run("read_note", { path: "Bread" });
    expect(r.read).toEqual(["Recipes/Bread.md"]);
    expect(r.content).toContain('Properties: {"status":"draft"}');
    expect(r.content).toContain("Sourdough");
    const s = run("read_note", { path: "Bread", section: "Starter" });
    expect(s.content).toContain("fed daily");
    expect(s.content).not.toContain("Sourdough");
    expect(run("read_note", { path: "Bread", section: "Oven" }).content).toContain("Its headings: Bread, Starter");
    expect(run("read_note", { path: "Nope" }).content).toContain("No note found");
  });

  it("follow links, mentions and neighbourhoods", () => {
    const l = JSON.parse(run("get_links", { path: "Bread" }).content);
    expect(l.linksOut).toEqual(["Cooking.md"]);
    expect(l.backlinks[0].from).toBe("Cooking.md");
    expect(l.unlinkedMentions[0].in).toBe("Recipes/Soup.md");
    const t = JSON.parse(run("traverse", { path: "Soup", depth: 2 }).content);
    expect(t.notes).toEqual(expect.arrayContaining([{ path: "Cooking.md", distance: 1 }, { path: "Recipes/Bread.md", distance: 2 }]));
  });

  it("list hubs, tags, properties and folders", () => {
    expect(JSON.parse(run("list_hubs", {}).content).hubs[0]).toMatchObject({ path: "Cooking.md", pinned: true });
    expect(JSON.parse(run("hub_for", { path: "Bread" }).content).inHubs[0].hub).toBe("Cooking.md");
    expect(JSON.parse(run("find_by_tag", {}).content)).toEqual({ food: 2 });
    expect(JSON.parse(run("find_by_tag", { tag: "#food" }).content).total).toBe(2);
    expect(JSON.parse(run("find_by_property", { key: "status" }).content).files).toEqual([{ path: "Recipes/Bread.md", status: "draft" }]);
    expect(JSON.parse(run("list_folder", { path: "" }).content)).toMatchObject({ folders: ["Recipes"], files: ["Cooking.md", "Garden.md"] });
    expect(JSON.parse(run("list_folder", { path: "Recipes" }).content).files).toEqual(["Recipes/Bread.md", "Recipes/Soup.md"]);
  });

  it("list tasks across notes, earliest due first", () => {
    const e = testEnv({
      "A.md": "# A\n\n- [ ] Later thing 📅 2026-12-10\n- [x] Done thing\n",
      "B.md": "## Today\n\n- [ ] Urgent ⏫ [due:: 2026-11-20] #work\n- [ ] Someday\n",
    });
    const all = JSON.parse(runTool(e, "list_tasks", "{}").content);
    expect(all.total).toBe(3);
    expect(all.tasks[0]).toEqual({ task: "Urgent #work", note: "B.md", due: "2026-11-20", priority: "high", under: "Today" });
    expect(JSON.parse(runTool(e, "list_tasks", JSON.stringify({ due_before: "2026-11-30" })).content).tasks.map((t: { task: string }) => t.task)).toEqual(["Urgent #work"]);
    expect(JSON.parse(runTool(e, "list_tasks", JSON.stringify({ status: "done" })).content).tasks[0].task).toBe("Done thing");
    expect(runTool(e, "list_tasks", JSON.stringify({ text: "zebra" })).content).toBe("No tasks match.");
  });

  it("report repository health", () => {
    const h = JSON.parse(run("repository_health", {}).content);
    expect(h.brokenLinks[0].missing).toBe("Compost");
    expect(h.orphans.some).toContain("Garden.md");
  });

  it("turn mistakes into messages the model can act on", () => {
    expect(runTool(env, "delete_everything", "{}").content).toContain("no tool");
    expect(runTool(env, "read_note", "{bad").content).toContain("valid JSON");
  });
});
