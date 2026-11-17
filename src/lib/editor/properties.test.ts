import { CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { LinkIndex } from "../links/link-index";
import { checkProperties, collectPropertyInfo, completeProperties } from "./properties";
import { linkHost, type LinkHost } from "./wikilinks";

const ix = new LinkIndex();
ix.set("A.md", "---\nstatus: draft\ntags: [work, idea]\n---\n#home");
ix.set("B.md", "---\nstatus: done\n---\n");
ix.set("C.md", "---\nstatus: draft\n---\n");
const info = collectPropertyInfo(ix);

/** Completions at "‸". */
function complete(doc: string, explicit = false): CompletionResult | null {
  const pos = doc.indexOf("‸");
  const host = { notes: () => [], headings: () => [], resolve: () => null, open: () => {}, propertyInfo: () => info } as LinkHost;
  const state = EditorState.create({ doc: doc.replace("‸", ""), extensions: [markdown(), linkHost.of(host)] });
  return completeProperties(new CompletionContext(state, pos, explicit)) as CompletionResult | null;
}
const labels = (r: CompletionResult | null) => r?.options.map((o) => o.label) ?? [];

describe("collectPropertyInfo", () => {
  it("counts names and values, and lists tags", () => {
    expect(info.keys).toEqual([
      { key: "status", count: 3 },
      { key: "tags", count: 1 },
    ]);
    expect(info.values("status")).toEqual(["draft", "done"]);
    expect(info.tags).toEqual(expect.arrayContaining(["work", "idea", "home"]));
  });
});

describe("completeProperties", () => {
  it("offers property names in the properties block, not elsewhere", () => {
    const r = complete("---\nta‸\n---\nbody");
    expect(labels(r)).toEqual(expect.arrayContaining(["tags", "aliases", "hub", "created", "status"]));
    expect(r!.from).toBe(4);
    expect(complete("---\ntags: []\n---\nta‸")).toBeNull();
    expect(complete("no properties ta‸")).toBeNull();
  });

  it("leaves out names already used", () => {
    expect(labels(complete("---\nhub: true\nh‸\n---\n"))).not.toContain("hub");
  });

  it("offers values that fit the property", () => {
    expect(labels(complete("---\nhub: ‸\n---\n", true))).toEqual(["true", "false"]);
    expect(labels(complete("---\nstatus: d‸\n---\n"))).toEqual(["draft", "done"]);
    expect(labels(complete("---\ntags: [work, i‸]\n---\n"))).toEqual(expect.arrayContaining(["idea", "home"]));
    expect(labels(complete("---\ntags: [work, i‸]\n---\n"))).not.toContain("work");
    expect(labels(complete("---\ncreated: ‸\n---\n", true))[0]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(labels(complete("---\ntags:\n  - h‸\n---\n"))).toContain("home");
    expect(complete("---\naliases: ‸\n---\n", true)).toBeNull();
  });
});

describe("checkProperties", () => {
  const check = (doc: string) => checkProperties(EditorState.create({ doc })).map((d) => d.message);

  it("is quiet for good properties", () => {
    expect(check("---\ntags: [a, b]\nhub: true\ncreated: 2026-01-02\n---\nx")).toEqual([]);
    expect(check("no properties")).toEqual([]);
  });

  it("flags wrong values, duplicates, bad YAML and an unclosed block", () => {
    expect(check("---\nhub: maybe\ncreated: soon\ntags: [two words]\n---\n")).toEqual([
      "hub should be true or false.",
      expect.stringContaining("created should be a date"),
      expect.stringContaining("Tags can't contain spaces"),
    ]);
    expect(check("---\nhub: true\nhub: false\n---\n")).toEqual(["hub is listed twice, so none of these properties apply. Remove one."]);
    expect(check("---\ntags: [a\n---\n")[0]).toContain("aren't valid YAML");
    expect(check("---\nhub: true\n")[0]).toContain("never end");
  });
});
