import { createRouter } from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import { routerWithQueryClient } from "@tanstack/react-router-with-query";
import { makeQueryClient } from "./api/query-client";
import { routeTree } from "./routeTree.gen";
import { currentCspNonce } from "./server/csp";

/**
 * Router options for one request.
 *
 * `ssr.nonce` is the per-response CSP nonce (#469): `cspMiddleware` mints it,
 * publishes the policy header from the same value, and passes it down the start
 * context, so the two cannot drift. It must be set at construction — the
 * framework reads it once, in `attachRouterServerSsrUtils`, to stamp every
 * inline script the document emits (the streaming barrier, the hydration
 * payload, the body scripts). Undefined means no policy is in play: the
 * browser, or the unit pool.
 */
function routerOptions(queryClient: QueryClient) {
  return {
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreload: "intent" as const,
    ssr: { nonce: currentCspNonce() },
  };
}

export function getRouter() {
  const queryClient = makeQueryClient();
  const router = createRouter(routerOptions(queryClient));
  return routerWithQueryClient(router, queryClient);
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
