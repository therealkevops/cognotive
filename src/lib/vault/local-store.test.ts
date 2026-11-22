import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { openDB } from "idb";
import { LocalStore } from "./local-store";

let n = 0;
const stores: LocalStore[] = [];
function makeStore() {
  let t = 1000;
  const store = new LocalStore(`test-${n++}`, () => t++);
  stores.push(store);
  return store;
}

afterEach(async () => {
  await Promise.all(stores.splice(0).map((s) => s.close()));
});

const paths = async (s: LocalStore) => (await s.list()).map((e) => e.path).sort();

describe("LocalStore", () => {
  it("writes, reads and lists files", async () => {
    const s = makeStore();
    await s.write("/Notes//a.md", "hello");
    expect(await s.read("Notes/a.md")).toMatchObject({ path: "Notes/a.md", content: "hello" });
    expect(await s.list()).toEqual([{ path: "Notes/a.md", kind: "file", mtime: 1000 }]);
  });

  it("overwrites and bumps mtime", async () => {
    const s = makeStore();
    await s.write("a.md", "1");
    await s.write("a.md", "2");
    expect(await s.read("a.md")).toMatchObject({ content: "2", mtime: 1001 });
  });

  it("returns undefined for a missing file", async () => {
    expect(await makeStore().read("nope.md")).toBeUndefined();
  });

  it("keeps vaults separate", async () => {
    const a = makeStore();
    const b = makeStore();
    await a.write("x.md", "a");
    expect(await b.list()).toEqual([]);
  });

  it("deletes a folder with everything in it, but not siblings sharing a prefix", async () => {
    const s = makeStore();
    await s.createFolder("P/empty");
    await s.write("P/a.md", "");
    await s.write("P/sub/b.md", "");
    await s.write("Px.md", "");
    await s.delete("P");
    expect(await paths(s)).toEqual(["Px.md"]);
  });

  it("renames a file", async () => {
    const s = makeStore();
    await s.write("a.md", "body");
    await s.rename("a.md", "Folder/b.md");
    expect(await paths(s)).toEqual(["Folder/b.md"]);
    expect((await s.read("Folder/b.md"))?.content).toBe("body");
  });

  it("moves a folder with its files and subfolders", async () => {
    const s = makeStore();
    await s.createFolder("A/empty");
    await s.write("A/one.md", "1");
    await s.write("A/sub/two.md", "2");
    await s.rename("A", "B/A2");
    expect(await paths(s)).toEqual(["B/A2/empty", "B/A2/one.md", "B/A2/sub/two.md"]);
  });

  it("refuses to overwrite on rename and leaves data unchanged", async () => {
    const s = makeStore();
    await s.write("a.md", "a");
    await s.write("b.md", "b");
    await expect(s.rename("a.md", "b.md")).rejects.toThrow(/already exists/);
    expect((await s.read("a.md"))?.content).toBe("a");
    expect((await s.read("b.md"))?.content).toBe("b");
  });

  it("refuses to move a folder into itself", async () => {
    const s = makeStore();
    await s.write("A/x.md", "");
    await expect(s.rename("A", "A/B")).rejects.toThrow(/into itself/);
  });

  it("writeIf only writes when the file still has the expected content", async () => {
    const s = makeStore();
    await s.write("a.md", "v1");
    expect(await s.writeIf("a.md", "stale", "v2")).toBe(false);
    expect((await s.read("a.md"))?.content).toBe("v1");
    expect(await s.writeIf("a.md", "v1", "v2")).toBe(true);
    expect((await s.read("a.md"))?.content).toBe("v2");
    expect(await s.writeIf("new.md", undefined, "n")).toBe(true);
    expect(await s.writeIf("new.md", undefined, "again")).toBe(false);
    expect(await s.writeIf("a.md", "v2", null)).toBe(true);
    expect(await s.read("a.md")).toBeUndefined();
  });

  it("stores attachments as bytes, alongside text files", async () => {
    const s = makeStore();
    const png = new Uint8Array([137, 80, 78, 71, 0, 255]);
    await s.writeBinary("attachments/pic.png", png);
    await s.write("note.md", "x");
    expect(await paths(s)).toEqual(["attachments/pic.png", "note.md"]);
    expect(await s.readBinary("attachments/pic.png")).toEqual(png);
    expect(await s.read("attachments/pic.png")).toBeUndefined();
  });

  it("moves and deletes attachments with their folder", async () => {
    const s = makeStore();
    await s.writeBinary("A/pic.png", new Uint8Array([1]));
    await s.rename("A", "B");
    expect(await s.readBinary("B/pic.png")).toEqual(new Uint8Array([1]));
    await expect(s.rename("B/pic.png", "B/pic.png")).resolves.toBeUndefined();
    await s.write("x.md", "");
    await expect(s.rename("x.md", "B/pic.png")).rejects.toThrow(/already exists/);
    await s.delete("B");
    expect(await paths(s)).toEqual(["x.md"]);
  });

  it("writeBinaryIf compares bytes", async () => {
    const s = makeStore();
    await s.writeBinary("a.png", new Uint8Array([1, 2]));
    expect(await s.writeBinaryIf("a.png", new Uint8Array([9]), new Uint8Array([3]))).toBe(false);
    expect(await s.writeBinaryIf("a.png", new Uint8Array([1, 2]), new Uint8Array([3]))).toBe(true);
    expect(await s.readBinary("a.png")).toEqual(new Uint8Array([3]));
    expect(await s.writeBinaryIf("a.png", new Uint8Array([3]), null)).toBe(true);
    expect(await s.readBinary("a.png")).toBeUndefined();
  });

  it("lists every file with its time after writes, compare-and-set writes, renames and deletes", async () => {
    const s = makeStore();
    await s.write("a.md", "a"); // 1000
    await s.writeBinary("Pics/x.png", new Uint8Array([1])); // 1001
    await s.writeIf("b.md", undefined, "b"); // 1002
    await s.writeBinaryIf("Pics/y.png", undefined, new Uint8Array([2])); // 1003
    expect((await s.list()).sort((x, y) => x.path.localeCompare(y.path))).toEqual([
      { path: "a.md", kind: "file", mtime: 1000 },
      { path: "b.md", kind: "file", mtime: 1002 },
      { path: "Pics/x.png", kind: "file", mtime: 1001 },
      { path: "Pics/y.png", kind: "file", mtime: 1003 },
    ]);
    await s.rename("Pics", "Images");
    await s.writeIf("b.md", "b", null);
    await s.writeBinaryIf("Images/y.png", new Uint8Array([2]), null);
    expect(await paths(s)).toEqual(["Images/x.png", "a.md"]);
    expect((await s.read("a.md"))?.mtime).toBe((await s.list()).find((e) => e.path === "a.md")?.mtime);
    await s.delete("Images");
    expect(await paths(s)).toEqual(["a.md"]);
  });

  it("lists what a repository saved before file entries were kept", async () => {
    const id = `test-${n++}`;
    // The database as the previous version left it: contents only.
    const old = await openDB(`noted-ai:vault:${id}`, 2, {
      upgrade(db) {
        db.createObjectStore("files", { keyPath: "path" });
        db.createObjectStore("folders", { keyPath: "path" });
        db.createObjectStore("blobs", { keyPath: "path" });
      },
    });
    await old.put("files", { path: "Notes/a.md", content: "hello", mtime: 5 });
    await old.put("blobs", { path: "Notes/p.png", bytes: new Uint8Array([7]).buffer, mtime: 6 });
    await old.put("folders", { path: "Empty", mtime: 4 });
    old.close();

    const s = new LocalStore(id);
    stores.push(s);
    expect((await s.list()).sort((x, y) => x.path.localeCompare(y.path))).toEqual([
      { path: "Empty", kind: "folder", mtime: 4 },
      { path: "Notes/a.md", kind: "file", mtime: 5 },
      { path: "Notes/p.png", kind: "file", mtime: 6 },
    ]);
    expect(await s.read("Notes/a.md")).toMatchObject({ content: "hello" });
    expect(await s.readBinary("Notes/p.png")).toEqual(new Uint8Array([7]));
  });

  it("says which paths changed after each saved change", async () => {
    const s = makeStore();
    const seen: string[][] = [];
    const stop = s.onChange((paths) => seen.push([...paths].sort()));
    await s.write("A/a.md", "a");
    await s.writeBinary("A/p.png", new Uint8Array([1]));
    expect(await s.writeIf("A/a.md", "wrong", "x")).toBe(false);
    await s.writeIf("A/a.md", "a", "b");
    await s.createFolder("A/Sub");
    await s.rename("A", "B");
    await s.delete("B/p.png");
    stop();
    await s.write("c.md", "c");
    expect(seen).toEqual([
      ["A/a.md"],
      ["A/p.png"],
      ["A/a.md"],
      ["A/Sub"],
      ["A/Sub", "A/a.md", "A/p.png", "B/Sub", "B/a.md", "B/p.png"],
      ["B/p.png"],
    ]);
  });

  it("waits for an older tab to let go of the database, and steps aside for a newer one", async () => {
    const id = `test-${n++}`;
    const name = `noted-ai:vault:${id}`;
    // An older version of the app, open in another tab, that doesn't know to close.
    const old = await openDB(name, 2, {
      upgrade(db) {
        db.createObjectStore("files", { keyPath: "path" });
        db.createObjectStore("folders", { keyPath: "path" });
        db.createObjectStore("blobs", { keyPath: "path" });
      },
    });
    const s = new LocalStore(id);
    stores.push(s);
    const heard: Array<string | null> = [];
    s.onUpgrade((w) => heard.push(w));
    const listing = s.list();
    await new Promise((r) => setTimeout(r, 20));
    expect(heard).toEqual(["blocked"]);
    old.close();
    expect(await listing).toEqual([]);
    expect(heard).toEqual(["blocked", null]);

    // A newer version opens: this one closes its connection so the upgrade can go ahead.
    const newer = await openDB(name, 4);
    expect(heard).toEqual(["blocked", null, "outdated"]);
    newer.close();
  });
});
