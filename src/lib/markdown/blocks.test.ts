import { describe, expect, it } from "vitest";
import { blockIdChange, blockIds, listBlocks, newBlockId } from "./blocks";

const note = `---
tags: [x]
---
# Title

First paragraph
on two lines.

- Item **one** ^item1
- [ ] Task [[Garden|the garden]]

> A quote
> continues.

\`\`\`js
not a block
\`\`\`

| a | b |
| - | - |

Last ^last`;

describe("listBlocks", () => {
  it("finds paragraphs, list items and quotes, with existing ids", () => {
    const blocks = listBlocks(note);
    expect(blocks.map((b) => [b.text, b.id])).toEqual([
      ["First paragraph on two lines.", undefined],
      ["Item one", "item1"],
      ["Task the garden", undefined],
      ["A quote continues.", undefined],
      ["Last", "last"],
    ]);
  });

  it("ends a block before its id, so an id goes on its last line", () => {
    const [para, item] = listBlocks(note);
    expect(note.slice(para.from, para.to)).toBe("First paragraph\non two lines.");
    expect(note.slice(item.from, item.to)).toBe("- Item **one**");
    const c = blockIdChange(para, "abc123");
    expect(note.slice(0, c.from) + c.insert + note.slice(c.from)).toContain("on two lines. ^abc123\n");
  });
});

describe("block ids", () => {
  it("collects ids and makes new unused ones", () => {
    expect([...blockIds(note)]).toEqual(["item1", "last"]);
    const id = newBlockId(new Set(["aaaaaa"]));
    expect(id).toMatch(/^[a-z0-9]{6}$/);
  });
});
