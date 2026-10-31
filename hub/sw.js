// SpiritHUB Workspaces service worker. Its only job is keeping the original SpiritHUB app's worker
// (scope /Spirit/) away from this app: pages under hub/ use this worker instead, and it has no fetch
// handler, so every request goes straight to the network and updates arrive immediately.
self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    // Remove what the original app's worker cached from this app before this worker took over.
    for (const name of await caches.keys()) {
      if (!/^(spirit|spirithub)-shell-/.test(name)) continue;
      const cache = await caches.open(name);
      for (const request of await cache.keys()) {
        const path = new URL(request.url).pathname;
        if (path.includes("/hub/")) {
          await cache.delete(request);
        } else if (path.endsWith("/index.html")) {
          // That worker saves every page it serves as its own offline page, this app's included.
          const page = await cache.match(request);
          if (page && (await page.text()).includes("SpiritHUB Workspaces")) await cache.delete(request);
        }
      }
    }
    await self.clients.claim();
  })());
});
