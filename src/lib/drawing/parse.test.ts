import { describe, expect, it } from "vitest";
import { elementLinkTarget, EMPTY_DRAWING, parseDrawing, rewriteDrawingLinks } from "./parse";

const drawing = JSON.stringify({
  type: "excalidraw",
  elements: [
    { id: "a", type: "text", text: "Garden plan, see [[Beds|the beds]]" },
    { id: "b", type: "rectangle", link: "[[Tools]]" },
    { id: "c", type: "rectangle", link: "https://example.com" },
    { id: "d", type: "text", text: "Deleted [[Gone]]", isDeleted: true },
    { id: "e", type: "ellipse", link: "Projects/Plan.md" },
  ],
});

describe("parseDrawing", () => {
  it("collects text and note links, skipping URLs and deleted elements", () => {
    const { text, links } = parseDrawing(drawing);
    expect(text).toBe("Garden plan, see [[Beds|the beds]]");
    expect(links.map((l) => l.target)).toEqual(["Beds", "Tools", "Projects/Plan.md"]);
    expect(links[0].alias).toBe("the beds");
  });

  it("copes with empty and broken files", () => {
    expect(parseDrawing(EMPTY_DRAWING)).toEqual({ text: "", links: [] });
    expect(parseDrawing("not json")).toEqual({ text: "", links: [] });
  });
});

describe("elementLinkTarget", () => {
  it("accepts wikilinks and vault paths only", () => {
    expect(elementLinkTarget("[[Note#H]]")).toBe("Note#H");
    expect(elementLinkTarget("Folder/Note")).toBe("Folder/Note");
    expect(elementLinkTarget("mailto:x@y.z")).toBeNull();
    expect(elementLinkTarget(null)).toBeNull();
  });
});

describe("rewriteDrawingLinks", () => {
  it("retargets matching element links and text links, keeping aliases", () => {
    const out = rewriteDrawingLinks(drawing, (t) => t === "Beds" || t === "Tools", "Raised beds");
    const els = JSON.parse(out!).elements;
    expect(els[0].text).toBe("Garden plan, see [[Raised beds|the beds]]");
    expect(els[1].link).toBe("[[Raised beds]]");
    expect(els[2].link).toBe("https://example.com");
  });

  it("returns null when nothing matched", () => {
    expect(rewriteDrawingLinks(drawing, () => false, "X")).toBeNull();
  });
});
