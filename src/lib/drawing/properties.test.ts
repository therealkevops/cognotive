import { describe, expect, it } from "vitest";
import { LinkIndex } from "../links/link-index";
import { drawingProperties, keepDrawingProperties, setDrawingProperty } from "./properties";

const scene = JSON.stringify({ type: "excalidraw", version: 2, elements: [], appState: {} });
const pluginMd = "---\nexcalidraw-plugin: parsed\ntags: [sketch]\n---\n# Text Elements\n\n%%\n## Drawing\n```json\n{\"type\":\"excalidraw\",\"elements\":[]}\n```\n%%\n";

describe("drawing properties", () => {
  it("live under a properties key in plain drawings", () => {
    const withTags = setDrawingProperty("d.excalidraw", scene, "tags", ["ideas"]);
    expect(drawingProperties("d.excalidraw", withTags)).toEqual({ tags: ["ideas"] });
    expect(JSON.parse(withTags).elements).toEqual([]);
    const both = setDrawingProperty("d.excalidraw", withTags, "hub", true);
    expect(drawingProperties("d.excalidraw", both)).toEqual({ tags: ["ideas"], hub: true });
    const none = setDrawingProperty("d.excalidraw", setDrawingProperty("d.excalidraw", both, "tags", undefined), "hub", undefined);
    expect("properties" in JSON.parse(none)).toBe(false);
    expect(drawingProperties("d.excalidraw", "not json")).toEqual({});
  });

  it("live in the frontmatter of the Obsidian plugin's drawings, next to its own keys", () => {
    expect(drawingProperties("d.excalidraw.md", pluginMd)).toEqual({ "excalidraw-plugin": "parsed", tags: ["sketch"] });
    const next = setDrawingProperty("d.excalidraw.md", pluginMd, "status", "draft");
    expect(next.startsWith("---\nexcalidraw-plugin: parsed\ntags: [sketch]\nstatus: draft\n---\n# Text Elements")).toBe(true);
    expect(next).toContain("## Drawing");
  });

  it("survive Excalidraw saving a plain drawing", () => {
    const before = setDrawingProperty("d.excalidraw", scene, "tags", ["ideas"]);
    const saved = JSON.stringify({ type: "excalidraw", version: 2, elements: [{ id: "x" }], appState: {} });
    const kept = keepDrawingProperties("d.excalidraw", saved, before);
    expect(JSON.parse(kept)).toMatchObject({ elements: [{ id: "x" }], properties: { tags: ["ideas"] } });
    expect(keepDrawingProperties("d.excalidraw", saved, scene)).toBe(saved);
  });

  it("are indexed: tags and aliases count", () => {
    const ix = new LinkIndex();
    ix.set("d.excalidraw", setDrawingProperty("d.excalidraw", scene, "tags", ["Ideas", "#work"]));
    ix.set("p.excalidraw.md", pluginMd);
    expect(ix.get("d.excalidraw")?.tags).toEqual(["ideas", "work"]);
    expect(ix.get("p.excalidraw.md")?.properties).toMatchObject({ tags: ["sketch"] });
    expect(ix.withTag("sketch")).toEqual(["p.excalidraw.md"]);
  });
});
