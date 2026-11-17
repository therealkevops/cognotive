/**
 * Parts of the app (the editor, canvases, drawings) are downloaded when first
 * needed, as files named after the build. After a new version is deployed, a
 * page opened before it asks for files that no longer exist. Reloading the page
 * once picks up the new version; a second failure soon after is a real error
 * (offline, say) and is passed on.
 */
const KEY = "noted-ai:chunk-reload";

export function reloadOnChunkError<T>(load: () => Promise<T>): () => Promise<T> {
  return () =>
    load().catch((err: unknown) => {
      if (typeof window === "undefined" || !isChunkError(err)) throw err;
      let last = 0;
      try {
        last = Number(sessionStorage.getItem(KEY) ?? 0);
      } catch {}
      if (Date.now() - last < 30_000) throw err;
      try {
        sessionStorage.setItem(KEY, String(Date.now()));
      } catch {}
      window.location.reload();
      // Never settles: the page is going away.
      return new Promise<T>(() => {});
    });
}

export function isChunkError(err: unknown): boolean {
  const e = err as { name?: string; message?: string } | null;
  const text = `${e?.name ?? ""} ${e?.message ?? ""}`;
  return /ChunkLoadError|Loading (CSS )?chunk|Failed to load chunk|Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i.test(
    text,
  );
}
