/**
 * The request handler: the whole service between authentication and relay
 * (#1792). Order is fixed and load-bearing:
 *
 *   route  — only the two named operations exist; anything else is refused
 *   config — a service without its key or ceiling refuses everything
 *   auth   — the signature is verified BEFORE the ceiling, so unauthenticated
 *            traffic cannot spend a single upstream slot
 *   ceiling— our promise to the upstream, enforced regardless of the caller,
 *            over the last 3600 seconds in an external store since #1810, so
 *            a restart cannot start a fresh budget
 *   relay  — the upstream's answer, verbatim, marked as the upstream's, asked
 *            from the one URL this service built and never redirected off it;
 *            an answer a response cannot carry is refused as `upstream-timeout`,
 *            with a `detail` naming why: a body past the limit, or a status a
 *            response cannot have
 */
import type { EgressConfig } from "./egress-config.ts";
import {
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  verifyRequestSignature,
  type SignatureHeaders,
} from "./request-signature.ts";
import { refusal } from "./response-marking.ts";
import type { CeilingDecision } from "./upstream-ceiling.ts";
import { resolveOperation } from "./upstream-operations.ts";
import { relay, type UpstreamFetch } from "./upstream-relay.ts";

/** The one method this service serves, and the one a 405's `Allow` header names. */
const SERVED_METHOD = "GET";

/**
 * Why the ceiling refused, when the reason alone does not say: the store
 * holding the last hour's window could not be reached, so the service refused
 * rather than count in memory (#1810).
 *
 * It travels in the refusal body's `detail`, NOT as a second
 * `x-egress-refusal` reason. That header's vocabulary is a contract with the
 * caller — `workers/catalog` classifies a refusal by it and does not know this
 * string, so a new reason there would be read as `unmarked`, "the answer did
 * not come from the egress service", which is false. The header keeps saying
 * whose refusal it is; the body says which of the two ceiling refusals it was.
 */
export const CEILING_STORE_DETAIL = "ceiling-store-unavailable";

/**
 * The upstream-request budget of the last hour; UpstreamRequestCeiling satisfies it.
 * Asynchronous because the count is not in this process any more (#1810): the
 * decision is the store's answer, and `store-unavailable` is a refusal.
 */
export interface Ceiling {
  tryAcquire(): Promise<CeilingDecision>;
}

/** Injectable dependencies; the composition root (server.ts) wires the real ones. */
export interface EgressDeps {
  /** null = configuration is missing: every request is refused. */
  config: EgressConfig | null;
  ceiling: Ceiling | null;
  upstreamFetch: UpstreamFetch;
  nowSeconds: () => number;
}

/** Handle one request. The entire service surface is this function plus its modules. */
export async function handleEgressRequest(request: Request, deps: EgressDeps): Promise<Response> {
  const refused = methodRefusal(request.method);
  if (refused !== null) return refused;
  const path = new URL(request.url).pathname;
  const operation = resolveOperation(path);
  if (operation === null) return noSuchOperation();
  if (deps.config === null || deps.ceiling === null) return refusal("configuration", 503);

  if (!authenticated(deps.config, request, path, deps.nowSeconds())) return refusal("auth", 401);
  const decision = await deps.ceiling.tryAcquire();
  if (decision !== "granted") return ceilingRefusal(decision);
  return relay(deps, operation);
}

/**
 * The refusal a method this service does not serve gets, or null for the one
 * it does. Exported for the request boundary, which has to ask before it lifts
 * a request: a Web `Request` cannot be constructed for every method node:http
 * delivers, so this one answer cannot wait for the handler. Both ask here, so
 * there is one list of served methods and one answer for the rest, a 405 whose
 * `Allow` names that list (RFC 9110 §15.5.6).
 */
export function methodRefusal(method: string | undefined): Response | null {
  if (method === SERVED_METHOD) return null;
  const refused = refusal("method-not-allowed", 405);
  refused.headers.set("allow", SERVED_METHOD);
  return refused;
}

/**
 * The refusal a request naming no operation gets. Exported for the request
 * boundary, which gives it to a target that is not a path (`*`, an absolute
 * URL) without lifting it: only a path can name an operation.
 */
export function noSuchOperation(): Response {
  return refusal("no-such-operation", 404);
}

/**
 * Our ceiling's refusal — one reason, two causes. The caller is told the same
 * thing either way: this service refused, do not read it as the upstream, do
 * not retry it in-request. Whether the last hour's budget ran out or the store
 * holding it was unreachable is an operator's question, and the body answers it.
 */
function ceilingRefusal(decision: CeilingDecision): Response {
  const detail = decision === "store-unavailable" ? CEILING_STORE_DETAIL : undefined;
  return refusal("ceiling", 429, detail);
}

/** Verify the request's signature headers against the configured keys. */
function authenticated(config: EgressConfig, request: Request, path: string, nowSeconds: number): boolean {
  const headers: SignatureHeaders = {
    timestamp: request.headers.get(TIMESTAMP_HEADER) ?? undefined,
    signature: request.headers.get(SIGNATURE_HEADER) ?? undefined,
  };
  return verifyRequestSignature(
    { current: config.currentKey, previous: config.previousKey },
    headers,
    path,
    nowSeconds,
  ).ok;
}
