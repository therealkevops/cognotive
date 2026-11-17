import { afterEach, describe, expect, it, vi } from "vitest";
import { isChunkError, reloadOnChunkError } from "./chunk";

describe("reloadOnChunkError", () => {
  afterEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it("recognises failed chunk downloads", () => {
    expect(isChunkError(Object.assign(new Error("Loading chunk 12 failed."), { name: "ChunkLoadError" }))).toBe(true);
    expect(isChunkError(new TypeError("Failed to fetch dynamically imported module: https://x/a.js"))).toBe(true);
    expect(isChunkError(new Error("boom"))).toBe(false);
  });

  it("reloads once for a chunk error, then passes a second one on", async () => {
    const reload = vi.fn();
    vi.spyOn(window, "location", "get").mockReturnValue({ ...window.location, reload } as Location);
    const failing = reloadOnChunkError(() => Promise.reject(new Error("Loading chunk 3 failed.")));
    void failing();
    await new Promise((r) => setTimeout(r, 0));
    expect(reload).toHaveBeenCalledTimes(1);
    await expect(failing()).rejects.toThrow("Loading chunk 3 failed.");
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("passes other errors and successes through", async () => {
    await expect(reloadOnChunkError(() => Promise.reject(new Error("boom")))()).rejects.toThrow("boom");
    await expect(reloadOnChunkError(() => Promise.resolve(5))()).resolves.toBe(5);
  });
});
