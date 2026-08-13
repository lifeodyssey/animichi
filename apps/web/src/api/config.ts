import { createIsomorphicFn } from "@tanstack/react-start";
import { getRequestUrl } from "@tanstack/react-start/server";

/**
 * Base-URL resolution for the catalog and users oRPC services.
 *
 * Same-origin by design (#550): the edge Worker fans `/v1/*`, `/v1/users/*`
 * and `/catalog/public/*` out to the services, so the base is the origin that
 * serves this app. The browser reads `location.origin`; SSR reads the
 * TanStack Start request context (`getRequestUrl`) with `VITE_SITE_ORIGIN`
 * as an explicit override. When the server has neither, resolution FAILS
 * LOUD: a silent relative base would point every catalog/users request at
 * this app itself (404s and HTML, no error).
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
  if (location) return location.origin;
  const explicit = env.VITE_SITE_ORIGIN ?? contextOrigin();
  if (explicit) return explicit;
  throw missingOriginError();
}

function missingOriginError(): Error {
  return new Error(
    "VITE_SITE_ORIGIN is unset and no SSR request context is available; refusing to let API requests silently target this app itself",
  );
}

export function resolveApiConfig(env: Env, location?: { readonly origin: string }): ApiConfig {
  if (env.VITE_CATALOG_URL !== undefined && env.VITE_USERS_URL !== undefined) {
    return { catalogUrl: env.VITE_CATALOG_URL, usersUrl: env.VITE_USERS_URL };
  }
  const origin = resolveOrigin(env, location);
  return {
    catalogUrl: env.VITE_CATALOG_URL ?? origin,
    usersUrl: env.VITE_USERS_URL ?? origin,
  };
}

/** The agent service base URL: `VITE_AGENT_URL` or the served origin. Shared
 * by the chat feature's config and cross-feature consumers (issue #1009 AC1)
 * so lib/ code never imports a feature for an origin. */
export function resolveAgentBaseUrl(env: Env, location?: { readonly origin: string }): string {
  return env.VITE_AGENT_URL ?? resolveOrigin(env, location);
}

export function currentApiConfig(): ApiConfig {
  const location = typeof window === "undefined" ? undefined : window.location;
  return resolveApiConfig(import.meta.env, location);
}
