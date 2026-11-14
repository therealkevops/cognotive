import { describe, expect, it } from "vitest";
import { NoteIndex, plainText } from "./note-index";

function index() {
  const ix = new NoteIndex();
  ix.set("Projects/Garden.md", "# Garden\nPlant **tomatoes** in spring. See [[Seeds]].");
  ix.set("Seeds.md", "Order seeds from the catalogue.\n\nTomatoes: cherry and roma.");
  ix.set("Recipes/Pasta.md", "Pasta with tomato sauce.");
  return ix;
}

describe("plainText", () => {
  it("strips markdown syntax but keeps the words", () => {
    expect(
      plainText(
        "---\ntags: x\n---\n# Head\n- [ ] **bold** ==hi== [[Note|alias]] [link](http://x)",
      ),
    ).toBe("Head\nbold hi alias link");
  });
});

describe("NoteIndex", () => {
  it("finds notes by body text, best match first", () => {
    const hits = index().search("tomatoes");
    expect(hits.map((h) => h.path)).toEqual(
      expect.arrayContaining(["Projects/Garden.md", "Seeds.md"]),
    );
  });

  it("ranks title matches above body matches", () => {
    expect(index().search("seeds")[0].path).toBe("Seeds.md");
  });

  it("matches prefixes and requires all terms", () => {
    const ix = index();
    expect(ix.search("gard").map((h) => h.path)).toEqual(["Projects/Garden.md"]);
    expect(ix.search("tomato sauce").map((h) => h.path)).toEqual(["Recipes/Pasta.md"]);
  });

  it("returns a snippet with match ranges", () => {
    const [hit] = index().search("catalogue");
    expect(hit.snippet).toContain("catalogue");
    const [s, e] = hit.matches[0];
    expect(hit.snippet.slice(s, e).toLowerCase()).toBe("catalogue");
  });

  it("updates and removes notes", () => {
    const ix = index();
    ix.set("Seeds.md", "nothing here");
    expect(ix.search("catalogue")).toEqual([]);
    ix.remove("Projects/Garden.md");
    expect(ix.size).toBe(2);
  });

  it("searches titles only for the quick switcher", () => {
    const ix = index();
    expect(ix.searchTitles("pas").map((h) => h.title)).toEqual(["Pasta"]);
    expect(ix.searchTitles("catalogue")).toEqual([]);
  });

  it("returns nothing for a blank query", () => {
    expect(index().search("  ")).toEqual([]);
  });
});
