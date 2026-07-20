import { resolveOrigin } from "../../api/config";

/**
 * Absolute site origin for SEO/JSON-LD URLs, resolved without touching the
 * anime route's loader: the browser's `location` on the client, the deploy's
 * `VITE_SITE_ORIGIN` / request context on the server (via `resolveOrigin`).
 */
export function currentLocation(): { readonly origin: string } | undefined {
  return typeof window === "undefined" ? undefined : window.location;
}

export function seoOrigin(location = currentLocation()): string {
  return resolveOrigin(import.meta.env, location);
}
