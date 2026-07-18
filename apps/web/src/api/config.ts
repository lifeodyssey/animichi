/**
 * Base-URL resolution for the catalog and users oRPC services.
 *
 * The catalog and users Workers are distinct origins, so each gets its own
 * base URL. SSR `fetch` needs an absolute origin (no `window`), so on the
 * server we require `VITE_SITE_ORIGIN`; the browser reads `location.origin`.
 */
export interface ApiConfig {
  readonly catalogUrl: string;
  readonly usersUrl: string;
}

type Env = Readonly<Record<string, string | undefined>>;

export function resolveOrigin(env: Env, location?: { readonly origin: string }): string {
  if (location) {
    return location.origin;
  }
  const origin = env.VITE_SITE_ORIGIN;
  if (!origin) {
    throw new Error("VITE_SITE_ORIGIN is required to build absolute SSR request origins");
  }
  return origin;
}

export function resolveApiConfig(env: Env, location?: { readonly origin: string }): ApiConfig {
  const origin = resolveOrigin(env, location);
  return {
    catalogUrl: env.VITE_CATALOG_URL ?? origin,
    usersUrl: env.VITE_USERS_URL ?? origin,
  };
}

export function currentApiConfig(): ApiConfig {
  const location = typeof window === "undefined" ? undefined : window.location;
  return resolveApiConfig(import.meta.env, location);
}
