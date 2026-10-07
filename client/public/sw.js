/* Groundwork Design Studio Service Worker — PWA Shell & Offline Cache */
const CACHE_NAME = "groundwork-shell-v2";
const APP_SHELL_ASSETS = [
  "/",
  "/index.html",
  "/logo.svg",
  "/logo.png",
  "/manifest.webmanifest",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL_ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.map((key) => {
            if (key !== CACHE_NAME) {
              return caches.delete(key);
            }
            return null;
          }),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  // Do not intercept non-GET requests or server API calls
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Bypass API calls — handled dynamically by offline queue manager
  if (url.pathname.startsWith("/api/")) return;

  // Handle SPA navigation requests: Network first with offline fallback to cached index.html
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(async () => {
          const cache = await caches.open(CACHE_NAME);
          const cachedIndex = await cache.match("/index.html");
          if (cachedIndex) return cachedIndex;
          return cache.match("/");
        }),
    );
    return;
  }

  // Handle static assets (scripts, styles, images, fonts): Stale-while-revalidate
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      const fetchPromise = fetch(request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return networkResponse;
        })
        .catch(() => cachedResponse);

      return cachedResponse || fetchPromise;
    }),
  );
});
