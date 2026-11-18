import { describe, expect, it } from "vitest";
import { deletePropertyIn, renamePropertyIn, setPropertyIn } from "./property-ops";

describe("renaming and deleting properties", () => {
  const note = "---\nstate: draft\ntags:\n  - a\n---\n# Note\nstate: not a property";

  it("renames in a note's frontmatter, keeping the value and the body", () => {
    expect(renamePropertyIn("n.md", note, "state", "status")).toBe("---\nstatus: draft\ntags:\n  - a\n---\n# Note\nstate: not a property");
    expect(renamePropertyIn("n.md", note, "tags", "labels")).toBe("---\nstate: draft\nlabels:\n  - a\n---\n# Note\nstate: not a property");
    expect(renamePropertyIn("n.md", note, "nope", "x")).toBe("unchanged");
    expect(renamePropertyIn("n.md", note, "state", "tags")).toBe("clash");
    expect(renamePropertyIn("n.md", "no frontmatter", "a", "b")).toBe("unchanged");
  });

  it("renames in drawings and canvases", () => {
    const d = JSON.stringify({ elements: [], properties: { a: 1, b: 2 } });
    expect(JSON.parse(renamePropertyIn("x.excalidraw", d, "a", "c") as string).properties).toEqual({ c: 1, b: 2 });
    const c = JSON.stringify({ nodes: [], edges: [], properties: { a: 1 } });
    expect(renamePropertyIn("x.canvas", c, "a", "z")).toContain('"z": 1');
    expect(renamePropertyIn("p.png", "", "a", "b")).toBe("unchanged");
  });

  it("deletes everywhere", () => {
    expect(deletePropertyIn("n.md", note, "state")).toBe("---\ntags:\n  - a\n---\n# Note\nstate: not a property");
    expect(deletePropertyIn("n.md", note, "nope")).toBe("unchanged");
    const d = JSON.stringify({ elements: [], properties: { a: 1 } });
    expect("properties" in JSON.parse(deletePropertyIn("x.excalidraw", d, "a") as string)).toBe(false);
  });
});

describe("setPropertyIn", () => {
  it("sets in notes, drawings and canvases, and leaves attachments", () => {
    expect(setPropertyIn("n.md", "# Hi", "status", "draft")).toBe("---\nstatus: draft\n---\n# Hi");
    expect(setPropertyIn("n.md", "---\nstatus: draft\n---\n# Hi", "status", undefined)).toBe("# Hi");
    expect(JSON.parse(setPropertyIn("d.excalidraw", '{"elements":[]}', "tags", ["a"]) as string).properties).toEqual({ tags: ["a"] });
    expect(JSON.parse(setPropertyIn("c.canvas", '{"nodes":[],"edges":[]}', "hub", true) as string).properties).toEqual({ hub: true });
    expect(setPropertyIn("p.png", "", "a", 1)).toBe("unchanged");
    expect(setPropertyIn("n.md", "# Hi", "status", undefined)).toBe("unchanged");
  });
});
