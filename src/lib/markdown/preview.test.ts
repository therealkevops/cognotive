import { describe, expect, it } from "vitest";
import { blockUnder, previewMarkdown } from "./preview";

const note = `# Garden

Intro line.

## Beds
Raised beds,
built in spring. ^beds1

- Tomatoes ^tom
- Beans

## Shed
Tools.`;

describe("previewMarkdown", () => {
  it("shows the whole note, a section, or a block", () => {
    expect(previewMarkdown(note)).toBe(note);
    expect(previewMarkdown(note, "Shed")).toBe("## Shed\nTools.");
    expect(previewMarkdown(note, "^beds1")).toBe("Raised beds,\nbuilt in spring.");
    expect(previewMarkdown(note, "Nope")).toBe("");
  });

  it("cuts very long notes", () => {
    const long = Array.from({ length: 2000 }, (_, i) => `Line ${i}`).join("\n");
    const out = previewMarkdown(long);
    expect(out.length).toBeLessThan(6100);
    expect(out.endsWith("…")).toBe(true);
  });
});

describe("blockUnder", () => {
  it("takes a single list item", () => {
    expect(blockUnder(note, "tom")).toBe("- Tomatoes");
    expect(blockUnder(note, "missing")).toBeNull();
  });
});
