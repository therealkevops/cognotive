import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { idbVectorStore } from "./semantic/idb-store";
import { repositoryUsage, storageParts, type CacheUsage, type RepositoryUsage } from "./storage-usage";
import { IdbSyncState } from "./sync/state";
import { LocalStore } from "./vault/local-store";

const repo = (over: Partial<RepositoryUsage> = {}): RepositoryUsage => ({
  id: "r",
  text: { count: 2, bytes: 1000 },
  attachments: { count: 1, bytes: 5000 },
  searchIndex: { count: 2, bytes: 3000 },
  sync: 200,
  ...over,
});
const cache: CacheUsage = { model: 49_000_000, app: 2_000_000, shared: 0 };

describe("storageParts", () => {
  it("adds up every repository and the caches, in a fixed order", () => {
    const { parts, total } = storageParts([repo(), repo({ id: "s", attachments: { count: 0, bytes: 0 } })], cache);
    expect(parts.map((p) => [p.id, p.bytes, p.detail])).toEqual([
      ["notes", 2000, "4 files"],
      ["attachments", 5000, "1 file"],
      ["model", 49_000_000, "Downloaded from this app for search by meaning"],
      ["index", 6000, "4 notes indexed"],
      ["rest", 2_000_400, "Sync records, app files for offline use"],
    ]);
    expect(total).toBe(51_013_400);
  });

  it("counts what the browser reports beyond the measured parts as overhead", () => {
    const { parts, total } = storageParts([repo()], cache, 60_000_000);
    expect(total).toBe(60_000_000);
    expect(parts.at(-1)).toMatchObject({ bytes: 60_000_000 - 49_000_000 - 9000, detail: "Sync records, app files for offline use, browser overhead" });
  });

  it("says when the model isn't downloaded and nothing is indexed", () => {
    const { parts } = storageParts([repo({ searchIndex: { count: 0, bytes: 0 }, sync: 0 })], { model: 0, app: 0, shared: 0 });
    expect(parts.find((p) => p.id === "model")?.detail).toBe("Not downloaded");
    expect(parts.find((p) => p.id === "index")?.detail).toBe("Nothing indexed");
    expect(parts.find((p) => p.id === "rest")?.detail).toBe("Nothing");
  });
});

describe("repositoryUsage", () => {
  it("measures a repository's files, search index and sync records", async () => {
    const store = new LocalStore("usage-1");
    await store.write("a.md", "abcd");
    await store.writeBinary("p.png", new Uint8Array(100));
    await store.close();
    await idbVectorStore("usage-1").put("a.md", { model: "m", hash: "h", chunks: [{ from: 0, preview: "abcd", vector: new Float32Array(4) }] });
    await new IdbSyncState("usage-1").save({ head: null, base: { "a.md": "sha" }, syncedAt: 1 });

    const u = await repositoryUsage("usage-1");
    expect(u.text).toEqual({ count: 1, bytes: 4 });
    expect(u.attachments).toEqual({ count: 1, bytes: 100 });
    expect(u.searchIndex).toEqual({ count: 1, bytes: 4 + 1 + 1 + 16 + 4 });
    expect(u.sync).toBeGreaterThan(0);
  });

  it("reports nothing for search and sync where they were never used, without creating them", async () => {
    const u = await repositoryUsage("usage-2");
    expect(u).toMatchObject({ searchIndex: { count: 0, bytes: 0 }, sync: 0 });
    const names = (await indexedDB.databases()).map((d) => d.name);
    expect(names).not.toContain("noted-ai:semantic:usage-2");
    expect(names).not.toContain("noted-ai:sync:usage-2");
  });
});
