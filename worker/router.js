// Pure routing decision for the main Cloudflare Worker.
//
// Extracted from entry.js so the branch table is unit-testable without the
// OpenNext-generated `./.open-next/worker.js` artifact (which only exists after
// a build). entry.js imports `routeKindFor` and wires each kind to its handler;
// this module has no Cloudflare/OpenNext imports so it loads under plain Node.
//
// Route kinds (checked in order — first match wins):
//   "healthz"  GET /healthz            -> RuntimeContainer (FastAPI) health
//   "image"    /img/*                  -> image proxy/cache
//   "catalog"  /catalog/*              -> CATALOG service binding (catalog Worker)
//   "next"     everything else         -> OpenNext (Next.js SSR + middleware,
//                                          which itself proxies /v1/* to the
//                                          container)
//
// Note: /v1/* is intentionally NOT a kind here — it is handled by the Next.js
// middleware inside the OpenNext handler, so it falls through to "next".

/**
 * Classify a request pathname into a route kind.
 * @param {string} pathname
 * @returns {"healthz" | "image" | "catalog" | "next"}
 */
export function routeKindFor(pathname) {
  if (pathname === "/healthz") return "healthz";
  if (pathname.startsWith("/img/")) return "image";
  if (pathname === "/catalog" || pathname.startsWith("/catalog/")) return "catalog";
  return "next";
}
