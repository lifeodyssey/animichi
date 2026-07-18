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

/** Lazy app-wide catalog utils; the stateless transport is safe to memoize. */
export function catalog(): CatalogUtils {
  cachedCatalog ??= createCatalogUtils(createCatalogClient({ url: currentApiConfig().catalogUrl }));
  return cachedCatalog;
}

/** Lazy app-wide users utils; the stateless transport is safe to memoize. */
export function users(): UsersUtils {
  cachedUsers ??= createUsersUtils(createUsersClient({ url: currentApiConfig().usersUrl }));
  return cachedUsers;
}
