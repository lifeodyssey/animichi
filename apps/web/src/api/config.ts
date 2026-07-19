import { createIsomorphicFn } from "@tanstack/react-start";
import { getRequestUrl } from "@tanstack/react-start/server";

/**
 * Base-URL resolution for the catalog and users oRPC services.
 *
 * The catalog and users Workers are distinct origins, so each gets its own
 * base URL. SSR `fetch` needs an absolute origin (no `window`): the server
 * reads the TanStack Start request context (`getRequestUrl`), with
 * `VITE_SITE_ORIGIN` as an explicit override; the browser reads
 * `location.origin`. When every source is missing we degrade to a relative
 * origin instead of throwing.
 */
export interface ApiConfig {
  readonly catalogUrl: string;
  readonly usersUrl: string;
}

type Env = Readonly<Record<string, string | undefined>>;

export type OriginSource = () => string | undefined;

function requestContextOrigin(): string | undefined {
  try {
    return getRequestUrl().origin;
  } catch {
    return undefined;
  }
}

const runtimeOrigin: OriginSource = createIsomorphicFn()
  .server(requestContextOrigin)
  .client(() => window.location.origin);

export function resolveOrigin(
  env: Env,
  location?: { readonly origin: string },
  contextOrigin: OriginSource = runtimeOrigin,
): string {
  if (location) {
    return location.origin;
  }
  return env.VITE_SITE_ORIGIN ?? contextOrigin() ?? "";
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
