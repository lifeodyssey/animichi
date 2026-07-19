import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import {
  type CatalogClient,
  type UsersClient,
  createCatalogClient,
  createUsersClient,
} from "./clients";
import { currentApiConfig } from "./config";

/** TanStack Query utils for the catalog service, keyed under `["catalog"]`. */
export function createCatalogUtils(client: CatalogClient) {
  return createTanstackQueryUtils(client, { path: ["catalog"] });
}

/** TanStack Query utils for the users service, keyed under `["users"]`. */
export function createUsersUtils(client: UsersClient) {
  return createTanstackQueryUtils(client, { path: ["users"] });
}

export type CatalogUtils = ReturnType<typeof createCatalogUtils>;
export type UsersUtils = ReturnType<typeof createUsersUtils>;

let cachedCatalog: CatalogUtils | undefined;
let cachedUsers: UsersUtils | undefined;

/** Memoization is browser-only: SSR resolves the origin per request, and a
 * module-global would freeze whichever accepted host served the first one. */
function isBrowser(): boolean {
  return typeof window !== "undefined";
}

function buildCatalogUtils(): CatalogUtils {
  return createCatalogUtils(createCatalogClient({ url: currentApiConfig().catalogUrl }));
}

function buildUsersUtils(): UsersUtils {
  return createUsersUtils(createUsersClient({ url: currentApiConfig().usersUrl }));
}

/** Catalog utils: fresh per SSR request, lazily memoized in the browser. */
export function catalog(): CatalogUtils {
  if (!isBrowser()) return buildCatalogUtils();
  cachedCatalog ??= buildCatalogUtils();
  return cachedCatalog;
}

/** Users utils: fresh per SSR request, lazily memoized in the browser. */
export function users(): UsersUtils {
  if (!isBrowser()) return buildUsersUtils();
  cachedUsers ??= buildUsersUtils();
  return cachedUsers;
}
