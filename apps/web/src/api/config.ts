import { createIsomorphicFn } from "@tanstack/react-start";
import { getRequestUrl } from "@tanstack/react-start/server";
import { currentRuntimeConfig } from "../lib/runtime-config/provider";

/**
 * Base-URL resolution for the catalog and users oRPC services.
 *
 * Same-origin by design (#550): the edge Worker fans `/v1/*`, `/v1/users/*`
 * and `/catalog/public/*` out to the services, so the base is the origin that
 * serves this app. The browser reads `location.origin`; SSR reads the
 * TanStack Start request context (`getRequestUrl`) with `api.siteOrigin`
 * (a runtime-config field, #1013 AC1) as an explicit override. When the server
 * has neither, resolution FAILS LOUD: a silent relative base would point every
 * catalog/users request at this app itself (404s and HTML, no error).
 */
export interface ApiConfig {
  readonly catalogUrl: string;
  readonly usersUrl: string;
}

export type OriginSource = () => string | undefined;

/** The runtime-config API origin block the pure resolvers read (#1013 AC1). */
export interface ApiOriginInput {
  readonly siteOrigin?: string;
  readonly catalogUrl?: string;
  readonly usersUrl?: string;
  readonly agentUrl?: string;
}

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
  api: ApiOriginInput,
  location?: { readonly origin: string },
  contextOrigin: OriginSource = runtimeOrigin,
): string {
  if (location) return location.origin;
  const explicit = api.siteOrigin ?? contextOrigin();
  if (explicit) return explicit;
  throw missingOriginError();
}

function missingOriginError(): Error {
  return new Error(
    "runtime config api.siteOrigin is unset and no SSR request context is available; refusing to let API requests silently target this app itself",
  );
}

export function resolveApiConfig(api: ApiOriginInput, location?: { readonly origin: string }): ApiConfig {
  if (api.catalogUrl !== undefined && api.usersUrl !== undefined) {
    return { catalogUrl: api.catalogUrl, usersUrl: api.usersUrl };
  }
  const origin = resolveOrigin(api, location);
  return {
    catalogUrl: api.catalogUrl ?? origin,
    usersUrl: api.usersUrl ?? origin,
  };
}

/** The agent service base URL: `api.agentUrl` or the served origin. Shared
 * by the chat feature's config and cross-feature consumers (issue #1009 AC1)
 * so lib/ code never imports a feature for an origin. */
export function resolveAgentBaseUrl(api: ApiOriginInput, location?: { readonly origin: string }): string {
  return api.agentUrl ?? resolveOrigin(api, location);
}

export function currentApiConfig(): ApiConfig {
  const location = typeof window === "undefined" ? undefined : window.location;
  return resolveApiConfig(currentRuntimeConfig().api, location);
}
