/**
 * Things shared to the installed app arrive as a form POST that the service
 * worker (public/sw.js) catches and keeps in this cache, because the app has
 * no server. The app takes them from here once it's open.
 */
export const SHARE_CACHE = "noted-ai-share";
const META = "/__share/meta";

export interface SharedItem {
  title: string;
  text: string;
  url: string;
  files: File[];
}

/** The last thing shared, removed from the cache; null if there's nothing. */
export async function takeShared(): Promise<SharedItem | null> {
  if (typeof caches === "undefined") return null;
  const cache = await caches.open(SHARE_CACHE);
  const meta = await cache.match(META);
  if (!meta) return null;
  const m = (await meta.json()) as { title?: string; text?: string; url?: string; files?: Array<{ key: string; name: string; type: string }> };
  const files: File[] = [];
  for (const f of m.files ?? []) {
    const res = await cache.match(f.key);
    if (res) files.push(new File([await res.blob()], f.name, { type: f.type }));
  }
  await caches.delete(SHARE_CACHE);
  return { title: m.title ?? "", text: m.text ?? "", url: m.url ?? "", files };
}
