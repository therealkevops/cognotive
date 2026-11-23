import { describe, expect, it } from "vitest";
import { unusedAttachments } from "./unused";

describe("unusedAttachments", () => {
  const files = [
    { path: "attachments/small.png", size: 10 },
    { path: "attachments/big photo.webp", size: 900 },
    { path: "attachments/linked.png", size: 500 },
    { path: "attachments/named.pdf", size: 300 },
    { path: "attachments/encoded name.png", size: 200 },
  ];
  const linked = new Set(["attachments/linked.png"]);

  it("lists attachments nothing links to or names, largest first", () => {
    const texts = ["See the report: named.pdf", "![x](attachments/encoded%20name.png)"];
    expect(unusedAttachments(files, (p) => linked.has(p), texts).map((f) => f.path)).toEqual([
      "attachments/big photo.webp",
      "attachments/small.png",
    ]);
  });

  it("is empty when everything is used", () => {
    expect(unusedAttachments(files.slice(2, 3), (p) => linked.has(p), [])).toEqual([]);
  });
});
