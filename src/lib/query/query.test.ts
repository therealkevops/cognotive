import { describe, expect, it } from "vitest";
import { LinkIndex } from "../links/link-index";
import { NoteIndex } from "../search/note-index";
import { queryContext } from "./context";
import { expandQueries, parseDataview, parseQueryBlock, queryToMarkdown, runQuery } from "./query";

const files: Record<string, string> = {
  "Projects/Garden.md": "---\ntags: [project, home]\nstatus: active\ndue: 2026-12-01\nowner: Ann\n---\n# Garden\n\nTomatoes and [[Compost]].\n\n- [ ] Order seeds [due:: 2026-11-20]\n- [x] Measure beds\n",
  "Projects/Website.md": "---\ntags: [project]\nstatus: active\ndue: 2026-11-25\n---\n# Website\n\nRedesign. See [[Garden]].\n\n- [ ] Pick fonts\n",
  "Projects/Old.md": "---\ntags: [project]\nstatus: done\n---\n# Old\n",
  "Compost.md": "# Compost\n\nGreens and browns. #home\n",
  "Hub.md": "# Hub\n\n```query\ntag:#project\n```\n",
};
const links = new LinkIndex();
const search = new NoteIndex();
for (const [p, c] of Object.entries(files)) {
  links.set(p, c);
  search.set(p, c);
}
const ctx = queryContext({
  links,
  search,
  mtime: (p) => (p === "Compost.md" ? Date.UTC(2026, 10, 1) : Date.UTC(2026, 10, 20)),
  linkFor: (p) => `[[${links.linkText(p)}]]`,
  today: "2026-11-22",
  self: "Hub.md",
});
const md = (src: string, lang: "query" | "dataview" = "query") => queryToMarkdown(src, lang, ctx);

describe("query blocks", () => {
  it("list notes by tag, leaving out the note holding the query", () => {
    expect(md("tag:#project")).toBe("- [[Garden]]\n- [[Old]]\n- [[Website]]");
    expect(md("#home -#project")).toBe("- [[Compost]]");
  });
  it("filter by property and words, and sort and limit", () => {
    expect(md("[status:active]\nsort: due desc")).toBe("- [[Garden]]\n- [[Website]]");
    expect(md("#project redesign")).toBe("- [[Website]]");
    expect(md("#project\nsort: file.name desc\nlimit: 1")).toBe("- [[Website]]\n\n*…and 2 more.*");
    expect(md("from: Projects\nwhere: due < date(\"2026-11-30\")")).toBe("- [[Website]]");
  });
  it("show tables with property columns", () => {
    expect(md("#project [status:active]\nshow: table status, due as \"Due date\", tags\nsort: due")).toBe(
      "| Note | status | Due date | tags |\n| --- | --- | --- | --- |\n| [[Website]] | active | 2026-11-25 | #project |\n| [[Garden]] | active | 2026-12-01 | #home #project |",
    );
  });
  it("show tasks across the matching notes", () => {
    expect(md("#project\nshow: tasks")).toBe("- [ ] Order seeds (due 2026-11-20) · [[Garden]]\n- [ ] Pick fonts · [[Website]]");
    expect(md("#project\nshow: done tasks")).toBe("- [x] Measure beds · [[Garden]]");
  });
  it("explain mistakes in place", () => {
    expect(md("show: chart")).toMatch(/^\*Query error: show: should be/);
    expect(md("where: status =")).toMatch(/^\*Query error: .*ends too soon/);
    expect(md("#nothing-has-this")).toBe("*No notes match this query.*");
  });
});

describe("dataview blocks", () => {
  it("LIST and TABLE with FROM, WHERE, SORT and LIMIT", () => {
    expect(md('LIST FROM #project WHERE status = "active" SORT due ASC', "dataview")).toBe("- [[Website]]\n- [[Garden]]");
    expect(md('TABLE status, owner FROM "Projects" WHERE status != "done" SORT file.name DESC LIMIT 1', "dataview")).toBe(
      "| Note | status | owner |\n| --- | --- | --- |\n| [[Website]] | active |  |\n\n*…and 1 more.*",
    );
  });
  it("FROM links, outgoing links, and combinations", () => {
    expect(md("LIST FROM [[Garden]]", "dataview")).toBe("- [[Website]]");
    expect(md("LIST FROM outgoing([[Garden]])", "dataview")).toBe("- [[Compost]]");
    expect(md('LIST FROM #home AND -"Projects"', "dataview")).toBe("- [[Compost]]");
    expect(md("LIST FROM (#home OR #project) AND -#project", "dataview")).toBe("- [[Compost]]");
  });
  it("TASK with conditions on tasks, over several lines", () => {
    expect(md("TASK\nFROM #project\nWHERE !completed AND due", "dataview")).toBe("- [ ] Order seeds (due 2026-11-20) · [[Garden]]");
    expect(md("TASK FROM #project", "dataview").split("\n")).toHaveLength(3);
  });
  it("file fields", () => {
    expect(md("LIST WHERE file.mtime < date(\"2026-11-10\")", "dataview")).toBe("- [[Compost]]");
    expect(md('LIST WHERE contains(file.name, "web")', "dataview")).toBe("- [[Website]]");
  });
  it("explain what isn't supported", () => {
    expect(md("CALENDAR file.mtime", "dataview")).toContain("CALENDAR views aren't supported");
    expect(md("LIST GROUP BY status", "dataview")).toContain("GROUP BY isn't supported");
    expect(md("SELECT *", "dataview")).toContain("starts with LIST, TABLE or TASK");
    expect(md("LIST FROM nonsense", "dataview")).toContain("FROM doesn't understand");
  });
});

describe("parsing", () => {
  it("reads options and filters", () => {
    const s = parseQueryBlock("#project [status:active] garden\nshow: table status\nsort: due desc, name", ctx);
    expect(s).toMatchObject({ view: "table", words: "garden", tags: [{ tag: "project", not: false }], props: [{ key: "status", value: "active" }] });
    expect(s.sort).toEqual([
      { field: "due", desc: true },
      { field: "name", desc: false },
    ]);
    expect(parseDataview("TABLE WITHOUT ID status", ctx).columns).toEqual([{ field: "status", label: "status" }]);
  });
  it("runs to structured results", () => {
    const r = runQuery(parseQueryBlock("#project", ctx), ctx);
    expect(r).toMatchObject({ view: "list", total: 3 });
  });
});

describe("expandQueries", () => {
  it("replaces query and dataview blocks, leaving other code alone", () => {
    const note = "Intro\n\n```query\n#home\n```\n\n```js\nquery()\n```\n\n~~~dataview\nLIST\n~~~\n";
    const out = expandQueries(note, (src, lang) => `RESULT(${lang}:${src.trim()})`);
    expect(out).toBe(
      "Intro\n\n\n<!-- query -->\n\nRESULT(query:#home)\n\n<!-- /query -->\n\n\n```js\nquery()\n```\n\n\n<!-- query -->\n\nRESULT(dataview:LIST)\n\n<!-- /query -->\n\n",
    );
  });
});
