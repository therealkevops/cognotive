import { describe, expect, it } from "vitest";
import { LinkIndex } from "../links/link-index";
import {
  movedFileProperties,
  parseFileProperties,
  serializeFileProperties,
  withFileProperty,
  withoutFileProperties,
} from "./file-properties";

describe("file properties", () => {
  it("parses, ignoring junk, and writes sorted", () => {
    expect(parseFileProperties('{"b.png": {"tags": ["x"]}, "a.png": {}, "c": 3}')).toEqual({ "b.png": { tags: ["x"] } });
    expect(parseFileProperties("oops")).toEqual({});
    expect(serializeFileProperties({ "b.png": { x: 1 }, "a.png": { y: 2 } })).toBe('{\n  "a.png": {\n    "y": 2\n  },\n  "b.png": {\n    "x": 1\n  }\n}\n');
  });

  it("sets and removes, dropping files with none left", () => {
    const one = withFileProperty({}, "a.png", "tags", ["x"]);
    expect(one).toEqual({ "a.png": { tags: ["x"] } });
    expect(withFileProperty(one, "a.png", "tags", undefined)).toEqual({});
  });

  it("follows moves and deletes", () => {
    const all = { "a.png": { x: 1 }, "b.png": { y: 2 } };
    expect(movedFileProperties(all, [["a.png", "pics/a.png"]])).toEqual({ "pics/a.png": { x: 1 }, "b.png": { y: 2 } });
    expect(movedFileProperties(all, [["c.png", "d.png"]])).toBeNull();
    expect(withoutFileProperties(all, ["b.png"])).toEqual({ "a.png": { x: 1 } });
    expect(withoutFileProperties(all, ["z.png"])).toBeNull();
  });

  it("are indexed for attachments, without making them notes", () => {
    const ix = new LinkIndex();
    ix.set("Note.md", "pic [[Other]]");
    ix.addFile("pic.png");
    ix.setFileProperties("pic.png", { tags: ["Photos"], aliases: ["Beach"] });
    expect(ix.withTag("photos")).toEqual(["pic.png"]);
    expect(ix.get("pic.png")?.aliases).toEqual(["Beach"]);
    expect(ix.graph().nodes.map((n) => n.id)).toEqual(["Note.md"]);
    expect(ix.mentionsIn("Note.md")).toEqual([]);
    ix.setFileProperties("pic.png", null);
    expect(ix.withTag("photos")).toEqual([]);
    expect(ix.resolve("pic.png")).toBe("pic.png");
  });
});
