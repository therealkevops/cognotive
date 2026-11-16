import { describe, expect, it } from "vitest";
import { addMissingProperties } from "../markdown/frontmatter";
import { withNewNoteProperties } from "./new-note-properties";

describe("withNewNoteProperties", () => {
  const now = new Date(2026, 10, 16);
  it("adds frontmatter with filled-in and empty values", () => {
    expect(withNewNoteProperties("", ["created", "tags", "status"], now)).toBe("---\ncreated: 2026-11-16\ntags: []\nstatus:\n---\n");
  });

  it("keeps a template's own values and adds only what's missing", () => {
    expect(withNewNoteProperties("---\ntags: [meeting]\n---\n# Hi", ["tags", "created"], now)).toBe(
      "---\ntags: [meeting]\ncreated: 2026-11-16\n---\n# Hi",
    );
  });

  it("does nothing with no keys, and skips names YAML can't take as they are", () => {
    expect(withNewNoteProperties("# Hi", [], now)).toBe("# Hi");
    expect(withNewNoteProperties("# Hi", ["bad name"], now)).toBe("# Hi");
    expect(addMissingProperties("---\na: 1\n---\nx", [["a", "2"]])).toBe("---\na: 1\n---\nx");
  });
});
