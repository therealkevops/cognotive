// k-note service worker: lets the installed app open without a connection.
// Notes themselves live in IndexedDB; this only caches the app's own files.
const CACHE = "noted-ai-v5";
// Something shared to the installed app, kept until the app takes it (src/lib/capture/shared.ts).
const SHARE_CACHE = "noted-ai-share";
const SHELL = "/";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.add(SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== SHARE_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

/** Keeps a share (its text and files) and opens the app on quick capture. */
async function keepShare(req) {
  try {
    const form = await req.formData();
    await caches.delete(SHARE_CACHE);
    const cache = await caches.open(SHARE_CACHE);
    const files = [];
    let i = 0;
    for (const f of form.getAll("files")) {
      if (!(f instanceof File) || !f.size) continue;
      const key = `/__share/file/${i++}`;
      await cache.put(key, new Response(f, { headers: { "Content-Type": f.type || "application/octet-stream" } }));
      files.push({ key, name: f.name || `shared-${i}`, type: f.type });
    }
    const meta = { title: form.get("title") || "", text: form.get("text") || "", url: form.get("url") || "", files };
    await cache.put("/__share/meta", new Response(JSON.stringify(meta), { headers: { "Content-Type": "application/json" } }));
  } catch {
    // Open the app anyway; there's just nothing to show.
  }
  return Response.redirect("/?action=shared", 303);
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method === "POST" && url.origin === self.location.origin && url.pathname === "/share-target") {
    event.respondWith(keepShare(req));
    return;
  }
  // Only this site's GET requests; never sign-in or other API calls.
  if (req.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  // Build output, fonts and icons never change at a given URL: cache first.
  if (/^\/(_next\/static|excalidraw|icons)\//.test(url.pathname)) {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      }),
    );
    return;
  }

  // Pages: the network when online (so updates arrive), the cached app shell when not.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok && url.pathname === "/") {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(SHELL, copy));
          }
          return res;
        })
        .catch(() => caches.match(SHELL).then((r) => r || Response.error())),
    );
  }
});
