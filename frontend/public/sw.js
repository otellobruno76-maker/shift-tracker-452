/* Registro Ore Lavoro — service worker (PWA installabile, funziona offline).
   ?mode=passthrough (dev): nessun caching, HMR intoccato.
   ?mode=cache (produzione): network-first con cache dei GET same-origin. */
const CACHE = "registro-ore-v1";
const MODE = self.location.search.includes("passthrough") ? "passthrough" : "cache";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/@") ||
    url.pathname.startsWith("/src/") ||
    url.pathname.includes("node_modules")
  ) {
    return;
  }
  if (MODE === "passthrough") return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      try {
        const fresh = await fetch(request);
        if (fresh && fresh.status === 200 && fresh.type === "basic") {
          cache.put(request, fresh.clone());
        }
        return fresh;
      } catch (err) {
        const cached = await cache.match(request, { ignoreSearch: request.mode === "navigate" });
        if (cached) return cached;
        if (request.mode === "navigate") {
          const shell = await cache.match("/");
          if (shell) return shell;
        }
        throw err;
      }
    })(),
  );
});
