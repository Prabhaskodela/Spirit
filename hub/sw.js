const CACHE_NAME = "spirithub-hub-shell-v6";
const APP_FILES = [
  "./",
  "./index.html",
  "./manifest.json",
  "../styles.css?v=20261101-pdf-fallback-2",
  "../app.js?v=20261101-pdf-fallback-2",
  "../app-config.js",
  "../logo.svg",
  "../spirit-wordmark.png",
  "../icon.svg",
  "../icons/icon-192.png",
  "../icons/icon-512.png",
  "../icons/icon-512-maskable.png"
];
const APP_ENTRY = new URL("./index.html", self.registration.scope).href;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("spirithub-hub-shell-") && key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(APP_ENTRY, copy));
        }
        return response;
      }).catch(() => caches.match(APP_ENTRY))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
      }
      return response;
    }))
  );
});
