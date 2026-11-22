import { AsyncLocalStorage } from "node:async_hooks";
import type { MiddlewareHandler } from "hono";
import { REQUEST_ID_HEADER } from "@animichi/contract/internal-binding";
import type { Env } from "../env.ts";

/**
 * The one ID that ties a request's log lines together across this gateway and
 * the services it forwards to.
 *
 * It is minted here for every request (`crypto.randomUUID()`: 36 characters,
 * lowercase hex) and never read from the request. A caller's own `X-Request-Id`
 * is replaced on every forward; Cloudflare's `cf-ray` is not used, because local
 * and test runs have none, a caller can send one there, and a minted ID has the
 * one format a downstream service can check exactly.
 *
 * The ID lives in the request's async scope (`AsyncLocalStorage`, which
 * `nodejs_compat` provides), never in module state: an overlapping request on
 * the same isolate cannot read another's, and code that runs outside any request
 * — a Durable Object alarm, a record written after the request ended — reads none.
 */
const scope = new AsyncLocalStorage<string>();

/** The ID of the request this code runs for, or undefined outside one. */
export function currentRequestId(): string | undefined {
  return scope.getStore();
}

/** A structured record, stamped with the ID of the request it was written for. */
export function withRequestId(record: Record<string, unknown>): Record<string, unknown> {
  const requestId = currentRequestId();
  return requestId === undefined ? record : { ...record, request_id: requestId };
}

/** The entry middleware: mint the ID, serve the request inside its scope, and
 * return the ID to the caller for support — the ID itself and nothing else. */
export const requestIdScope: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  const requestId = crypto.randomUUID();
  await scope.run(requestId, next);
  c.header(REQUEST_ID_HEADER, requestId);
};
