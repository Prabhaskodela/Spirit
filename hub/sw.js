// SpiritHUB Workspaces service worker.
const CACHE_NAME = "spirithub-hub-shell-v1";
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
    // Remove caches from the original Spirit app that could otherwise serve stale hub pages.
    for (const name of await caches.keys()) {
      if (/^(spirit|spirithub)-shell-/.test(name) && name !== CACHE_NAME) {
        const cache = await caches.open(name);
        for (const request of await cache.keys()) {
          const path = new URL(request.url).pathname;
          if (path.includes("/hub/")) {
            await cache.delete(request);
          } else if (path.endsWith("/index.html")) {
            const page = await cache.match(request);
            if (page && (await page.text()).includes("SpiritHUB Workspaces")) await cache.delete(request);
          }
        }
      }
    }
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;

  const url = new URL(request.url);
  if (!url.pathname.startsWith("/Spirit/hub/")) return;

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
