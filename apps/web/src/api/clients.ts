import { createORPCClient } from "@orpc/client";
import type { ClientOptions } from "@orpc/client";
import { OpenAPILink } from "@orpc/openapi-client/fetch";
import type { JsonifiedClient } from "@orpc/openapi-client";
import type { ContractRouterClient } from "@orpc/contract";
import {
  type CatalogContract,
  type UsersContract,
  catalogContract,
  usersContract,
} from "@seichijunrei/contract";
import type { ApiClientContext } from "./context";

export type CatalogClient = JsonifiedClient<ContractRouterClient<CatalogContract, ApiClientContext>>;
export type UsersClient = JsonifiedClient<ContractRouterClient<UsersContract, ApiClientContext>>;

interface ClientFactoryOptions {
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>>;
}

function mergeHeaders(
  base: ClientFactoryOptions["headers"],
  context: ApiClientContext | undefined,
): Record<string, string> {
  return { ...base, ...context?.headers };
}

export function createCatalogClient(config: ClientFactoryOptions): CatalogClient {
  const link = new OpenAPILink<ApiClientContext>(catalogContract, {
    url: config.url,
    headers: (options: ClientOptions<ApiClientContext>) => mergeHeaders(config.headers, options.context),
  });
  return createORPCClient<CatalogClient>(link);
}

export function createUsersClient(config: ClientFactoryOptions): UsersClient {
  const link = new OpenAPILink<ApiClientContext>(usersContract, {
    url: config.url,
    headers: (options: ClientOptions<ApiClientContext>) => mergeHeaders(config.headers, options.context),
  });
  return createORPCClient<UsersClient>(link);
}
