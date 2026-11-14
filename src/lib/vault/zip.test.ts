import "fake-indexeddb/auto";
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { LocalStore } from "./local-store";
import { exportVault, readZip } from "./zip";

describe("vault zips", () => {
  it("round-trips notes and attachments", async () => {
    const store = new LocalStore("zip-test");
    await store.write("Notes/a.md", "# A");
    await store.writeBinary("attachments/p.png", new Uint8Array([137, 80, 78, 71]));
    const files = readZip(await exportVault(store));
    expect(new TextDecoder().decode(files.get("Notes/a.md"))).toBe("# A");
    expect(files.get("attachments/p.png")).toEqual(new Uint8Array([137, 80, 78, 71]));
    await store.close();
  });

  it("drops a single top-level folder and skips junk", () => {
    const zip = zipSync({
      "My Vault/a.md": strToU8("a"),
      "My Vault/sub/b.md": strToU8("b"),
      "My Vault/.obsidian/app.json": strToU8("{}"),
      "__MACOSX/My Vault/._a.md": strToU8("x"),
    });
    expect([...readZip(zip).keys()].sort()).toEqual(["a.md", "sub/b.md"]);
  });

  it("keeps paths when files sit at the top level", () => {
    const zip = zipSync({ "a.md": strToU8("a"), "Folder/b.md": strToU8("b") });
    expect([...readZip(zip).keys()].sort()).toEqual(["Folder/b.md", "a.md"]);
  });
});
