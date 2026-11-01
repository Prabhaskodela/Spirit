// Retire the old /hub/ service worker after the app moves to the repository root.
self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    await caches.delete("spirithub-hub-shell-v1");
    await self.registration.unregister();
    await self.clients.claim();
  })());
});
