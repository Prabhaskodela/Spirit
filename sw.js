// SpiritHUB Workspaces service worker.
const CACHE_NAME = "spirithub-shell-v9";
const APP_SHELL = new URL("./", self.location.href).href;

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    try { await cache.add(new Request(APP_SHELL, { cache: "reload" })); } catch {}
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    // Remove old app caches so stale pages from either former entry point cannot take over.
    const oldCaches = (await caches.keys())
      .filter((name) => /^(spirit|spirithub)-shell-/.test(name) && name !== CACHE_NAME);
    await Promise.all(oldCaches.map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;

  const url = new URL(request.url);
  const appRoot = new URL("./", self.location.href).pathname;
  if (!url.pathname.startsWith(appRoot)) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      const response = await fetch(request);
      if (response.ok && response.type === "basic") {
        await cache.put(request, response.clone());
      }
      return response;
    } catch {
      const cached = await cache.match(request, { ignoreSearch: true });
      if (cached) return cached;
      if (request.mode === "navigate") {
        return (await cache.match(APP_SHELL)) || Response.error();
      }
      return Response.error();
    }
  })());
});
