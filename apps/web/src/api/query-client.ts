import { QueryClient } from "@tanstack/react-query";

/**
 * Build a fresh {@link QueryClient}.
 *
 * `getRouter` calls this once per request so server renders never share a
 * cache across users; the client hydrates the dehydrated server cache instead
 * of refetching (wired by `routerWithQueryClient`).
 */
export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000 } },
  });
}
