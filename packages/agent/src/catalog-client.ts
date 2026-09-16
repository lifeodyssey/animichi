import { catalogContract } from "@animichi/contract/contract";
import { createORPCClient, ORPCError } from "@orpc/client";
import { ClientRetryPlugin, type ClientRetryPluginContext } from "@orpc/client/plugins";
import type { ContractRouterClient } from "@orpc/contract";
import { RequestValidationPlugin, ResponseValidationPlugin } from "@orpc/contract/plugins";
import { OpenAPILink } from "@orpc/openapi-client/fetch";

/**
 * Anchors for the signal chain a delivered request follows: the link's request and the composed deadline.
 *
 * `AbortSignal.any` keeps its sources only weakly reachable, so a chain survives solely while something
 * holds it. The link drops its request once an attempt settles; a cancellation arriving during retry
 * backoff would then never reach the attempt already delivered, and the request would run on to its own
 * deadline. Anchoring the chain to the delivered request keeps it abortable for exactly as long as a
 * transport may still hold that request.
 */
const signalAnchors = new WeakMap<Request, [Request, AbortSignal]>();

/** Read-only catalog calls retry transient failures inside the caller's bounded deadline. */
export function createCatalogClient(fetch: (request: Request) => Promise<Response>) {
  const link = new OpenAPILink<ClientRetryPluginContext>(catalogContract, {
    url: "https://catalog.internal", fetch: (request) => fetchWithinDeadline(fetch, request),
    plugins: [new RequestValidationPlugin(catalogContract), new ResponseValidationPlugin(catalogContract),
      new ClientRetryPlugin({ default: { retry: 2, shouldRetry: ({ error }) => transient(error) } })],
    interceptors: [(options) => options.next({ ...options, signal: catalogDeadline(options.signal) })],
  });
  return createORPCClient<ContractRouterClient<typeof catalogContract, ClientRetryPluginContext>>(link);
}

function transient(error: unknown): boolean {
  return error instanceof DOMException && error.name === "TimeoutError"
    || error instanceof ORPCError && (error.status >= 500 || error.status === 408 || error.status === 429);
}

function catalogDeadline(signal?: AbortSignal): AbortSignal {
  return AbortSignal.any([AbortSignal.timeout(80_000), ...(signal ? [signal] : [])]);
}

async function fetchWithinDeadline(fetch: (request: Request) => Promise<Response>, request: Request) {
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(25_000)]);
  signal.throwIfAborted();
  const bounded = new Request(request, { signal, redirect: "manual" });
  signalAnchors.set(bounded, [request, signal]);
  return forbidRedirects(await fetch(bounded));
}

async function forbidRedirects(response: Response) {
  if (response.status < 300 || response.status >= 400) return response;
  await response.body?.cancel();
  throw new Error("Catalog redirects are not permitted");
}
