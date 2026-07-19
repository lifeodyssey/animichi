/**
 * Service worker for /anime pages — network-first (spec X7 hard AC).
 *
 * A navigation to /anime/:id always tries the network so the SW never serves
 * stale HTML; the cache is only a fallback for network failure (offline).
 * Standard Service Worker API, no libraries. Classic script served from
 * public/, typed via JSDoc for the type-aware lint gate.
 *
 * @typedef {{ request: Request, respondWith: (response: Promise<Response>) => void, waitUntil: (task: Promise<unknown>) => void }} SwEvent
 * @typedef {{ addEventListener: (type: string, listener: (event: SwEvent) => void) => void, skipWaiting: () => void, clients: { claim: () => Promise<void> }, caches: CacheStorage, fetch: (request: Request) => Promise<Response> }} SwScope
 */
const scope = /** @type {SwScope} */ (/** @type {unknown} */ (globalThis));

const CACHE_NAME = "anime-html-v1";

/** @param {Request} request */
function isAnimeNavigation(request) {
  return request.mode === "navigate" && new URL(request.url).pathname.startsWith("/anime/");
}

/**
 * @param {Cache} cache
 * @param {Request} request
 * @param {Response} response
 */
async function refreshCache(cache, request, response) {
  if (response.ok) {
    await cache.put(request, response.clone());
  }
  return response;
}

/**
 * @param {Cache} cache
 * @param {Request} request
 * @param {unknown} error
 */
async function fallbackToCache(cache, request, error) {
  const cached = await cache.match(request);
  if (cached) {
    return cached;
  }
  throw error;
}

/** @param {Request} request */
async function networkFirst(request) {
  const cache = await scope.caches.open(CACHE_NAME);
  try {
    return await refreshCache(cache, request, await scope.fetch(request));
  } catch (error) {
    return await fallbackToCache(cache, request, error);
  }
}

scope.addEventListener("install", () => {
  scope.skipWaiting();
});

scope.addEventListener("activate", (event) => {
  event.waitUntil(scope.clients.claim());
});

scope.addEventListener("fetch", (event) => {
  if (isAnimeNavigation(event.request)) {
    event.respondWith(networkFirst(event.request));
  }
});
