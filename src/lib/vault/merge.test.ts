import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { LocalStore } from "./local-store";
import { mergeInto } from "./merge";

let n = 0;
const stores = () => [new LocalStore(`merge-src-${n}`), new LocalStore(`merge-dst-${n++}`)] as const;

describe("mergeInto", () => {
  it("copies everything under a folder, leaving the source's settings behind", async () => {
    const [src, dst] = stores();
    await src.write("Plan.md", "# Plan\n[[Ideas]]");
    await src.write("Notes/Ideas.md", "# Ideas");
    await src.writeBinary("attachments/pic.png", new Uint8Array([1, 2, 3]));
    await src.write(".noted/settings.json", "{}");
    await src.createFolder("Empty");
    await dst.write("Welcome.md", "# Welcome");
    const steps: string[] = [];

    const r = await mergeInto(src, dst, "Local notes", (d, t) => steps.push(`${d}/${t}`));
    expect(r).toMatchObject({ added: 3, skipped: 0, renamed: 0 });
    expect(steps.at(-1)).toBe("3/3");
    expect((await dst.read("Local notes/Plan.md"))?.content).toBe("# Plan\n[[Ideas]]");
    expect((await dst.read("Local notes/Notes/Ideas.md"))?.content).toBe("# Ideas");
    expect([...(await dst.readBinary("Local notes/attachments/pic.png"))!]).toEqual([1, 2, 3]);
    expect(await dst.read("Local notes/.noted/settings.json")).toBeUndefined();
    expect((await dst.list()).some((e) => e.path === "Local notes/Empty" && e.kind === "folder")).toBe(true);
    expect((await dst.read("Welcome.md"))?.content).toBe("# Welcome");
    await Promise.all([src.close(), dst.close()]);
  });

  it("at the top level: skips files that are the same, renames ones that differ, overwrites nothing", async () => {
    const [src, dst] = stores();
    await src.write("Same.md", "same");
    await src.write("Clash.md", "from the source");
    await src.write("New.md", "new");
    await dst.write("Same.md", "same");
    await dst.write("Clash.md", "already here");

    const r = await mergeInto(src, dst, "");
    expect(r).toMatchObject({ added: 1, skipped: 1, renamed: 1 });
    expect(r.paths.sort()).toEqual(["Clash 1.md", "New.md"]);
    expect((await dst.read("Clash.md"))?.content).toBe("already here");
    expect((await dst.read("Clash 1.md"))?.content).toBe("from the source");
    await Promise.all([src.close(), dst.close()]);
  });
});
