import { describe, expect, it } from "vitest";
import { decideSave, otherWindowCopyPath } from "./save-merge";

const none = () => false;

describe("decideSave", () => {
  it("saves this window's text when nothing else changed the file", () => {
    expect(decideSave("a.md", "new", "old", "old", none)).toEqual({ text: "new" });
    expect(decideSave("a.md", "new", "old", undefined, none)).toEqual({ text: "new" });
  });

  it("merges changes another window made elsewhere in the note", () => {
    const base = "# Plan\n\nfirst\n\nsecond\n";
    const ours = "# Plan\n\nfirst, edited here\n\nsecond\n";
    const theirs = "# Plan\n\nfirst\n\nsecond, edited there\n";
    expect(decideSave("Plan.md", ours, base, theirs, none)).toEqual({ text: "# Plan\n\nfirst, edited here\n\nsecond, edited there\n" });
  });

  it("keeps both when the same lines changed in both windows", () => {
    expect(decideSave("Notes/Plan.md", "mine\n", "start\n", "theirs\n", none)).toEqual({
      text: "mine\n",
      copy: { path: "Notes/Plan (from another window).md", content: "theirs\n" },
    });
  });

  it("doesn't merge line by line inside drawings and canvases", () => {
    const r = decideSave("Board.canvas", '{"a":2}', '{"a":1}', '{"b":1}', none);
    expect(r.text).toBe('{"a":2}');
    expect(r.copy?.path).toBe("Board (from another window).canvas");
  });
});

describe("otherWindowCopyPath", () => {
  it("keeps the extension, including a drawing's double one, and numbers clashes", () => {
    expect(otherWindowCopyPath("Sketch.excalidraw.md", none)).toBe("Sketch (from another window).excalidraw.md");
    const taken = new Set(["a (from another window).md"]);
    expect(otherWindowCopyPath("a.md", (p) => taken.has(p))).toBe("a (from another window 2).md");
  });
});
