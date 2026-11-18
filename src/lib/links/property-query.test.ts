import { describe, expect, it } from "vitest";
import { LinkIndex } from "./link-index";
import { filesWithProperties, parsePropertyQuery, valueText } from "./property-query";

describe("property search", () => {
  it("reads [key] and [key:value] terms and leaves the rest as text", () => {
    expect(parsePropertyQuery("[status:draft] plans [hub]")).toEqual({
      terms: [{ key: "status", value: "draft" }, { key: "hub" }],
      text: "plans",
    });
    expect(parsePropertyQuery("just words")).toBeNull();
    expect(parsePropertyQuery("[ tags : work ]")).toEqual({ terms: [{ key: "tags", value: "work" }], text: "" });
  });

  it("finds files by property, values in lists, any case", () => {
    const ix = new LinkIndex();
    ix.set("A.md", "---\nstatus: Draft\ntags: [work, home]\n---\n");
    ix.set("B.md", "---\nstatus: done\n---\n");
    ix.set("C.md", "no properties");
    ix.addFile("pic.png");
    ix.setFileProperties("pic.png", { status: "draft" });
    expect(filesWithProperties(ix, [{ key: "status" }])).toEqual(["A.md", "B.md", "pic.png"]);
    expect(filesWithProperties(ix, [{ key: "Status", value: "draft" }])).toEqual(["A.md", "pic.png"]);
    expect(filesWithProperties(ix, [{ key: "tags", value: "home" }, { key: "status" }])).toEqual(["A.md"]);
    expect(valueText(["a", 1, true])).toBe("a, 1, true");
  });
});
