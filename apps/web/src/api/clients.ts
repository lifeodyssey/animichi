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

type HeaderSource =
  | Readonly<Record<string, string>>
  | (() => Promise<Readonly<Record<string, string>>>);

interface ClientFactoryOptions {
  readonly url: string;
  readonly headers?: HeaderSource;
}

async function resolveBaseHeaders(source: HeaderSource | undefined): Promise<Record<string, string>> {
  if (!source) return {};
  return typeof source === "function" ? { ...(await source()) } : { ...source };
}

async function mergeHeaders(
  base: HeaderSource | undefined,
  context: ApiClientContext | undefined,
): Promise<Record<string, string>> {
  return { ...(await resolveBaseHeaders(base)), ...context?.headers };
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
