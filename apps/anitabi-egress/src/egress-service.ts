/**
 * The request handler: the whole service between authentication and relay
 * (#1792). Order is fixed and load-bearing:
 *
 *   route  — only the two named operations exist; anything else is refused
 *   config — a service without its key or ceiling refuses everything
 *   auth   — the signature is verified BEFORE the ceiling, so unauthenticated
 *            traffic cannot spend a single upstream slot
 *   ceiling— our promise to the upstream, enforced regardless of the caller
 *   relay  — the upstream's answer, verbatim, marked as the upstream's
 *
 * Our own refusals are unmistakable: header `x-egress-response: refused-here`
 * plus a `x-egress-refusal` reason. Upstream answers carry
 * `x-egress-response: relayed-upstream` and never a refusal reason. A caller
 * can tell the three failure worlds apart — upstream refused us, upstream
 * failed, this service refused — without parsing prose (#1792).
 */
import type { EgressConfig } from "./egress-config.ts";
import {
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  verifyRequestSignature,
  type SignatureHeaders,
} from "./request-signature.ts";
import {
  resolveOperation,
  upstreamUrlFor,
  UPSTREAM_USER_AGENT,
  type EgressOperation,
} from "./upstream-operations.ts";

/** Which answer produced this response: the upstream's, or this service's refusal. */
export const RESPONSE_MARKER_HEADER = "x-egress-response";
export const RELAYED_MARKER = "relayed-upstream";
export const REFUSED_MARKER = "refused-here";
export const REFUSAL_HEADER = "x-egress-refusal";

export type RefusalReason =
  | "no-such-operation"
  | "method-not-allowed"
  | "auth"
  | "ceiling"
  | "configuration"
  | "upstream-timeout";

/** The upstream fetch surface; the real service passes global `fetch`. */
export type UpstreamFetch = (
  url: string,
  init?: { headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<UpstreamResponseLike>;

/** The part of a fetch Response the relay needs. */
export interface UpstreamResponseLike {
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  arrayBuffer(): Promise<ArrayBuffer>;
}

/** The hourly upstream-request budget; UpstreamRequestCeiling satisfies it. */
export interface Ceiling {
  tryAcquire(): boolean;
}

/** Injectable dependencies; the composition root (server.ts) wires the real ones. */
export interface EgressDeps {
  /** null = configuration is missing: every request is refused. */
  config: EgressConfig | null;
  ceiling: Ceiling | null;
  upstreamFetch: UpstreamFetch;
  nowSeconds: () => number;
}

/** Give the upstream a fair chance to answer before we fail closed. */
const UPSTREAM_TIMEOUT_MS = 10_000;

/** Handle one request. The entire service surface is this function plus its modules. */
export async function handleEgressRequest(request: Request, deps: EgressDeps): Promise<Response> {
  if (request.method !== "GET") return refusal("method-not-allowed", 405);
  const path = new URL(request.url).pathname;
  const operation = resolveOperation(path);
  if (operation === null) return refusal("no-such-operation", 404);
  if (deps.config === null || deps.ceiling === null) return refusal("configuration", 503);

  if (!authenticated(deps.config, request, path, deps.nowSeconds())) return refusal("auth", 401);
  if (!deps.ceiling.tryAcquire()) return refusal("ceiling", 429);
  return relay(deps, operation);
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

/** Fetch the one upstream URL the operation names and mark the answer as relayed. */
async function relay(deps: EgressDeps, operation: EgressOperation): Promise<Response> {
  const url = upstreamUrlFor(operation);
  let upstream: UpstreamResponseLike;
  let body: ArrayBuffer;
  try {
    upstream = await deps.upstreamFetch(url, {
      headers: { "user-agent": UPSTREAM_USER_AGENT },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    // Read the body here, inside the same guard: arriving headers are not a
    // delivered answer, and a reset or stalled stream rejects on this line.
    // Outside it, that rejection would escape the handler and the caller would
    // get no response at all rather than our marked refusal.
    body = await upstream.arrayBuffer();
  } catch {
    return refusal("upstream-timeout", 504);
  }
  const headers = new Headers({ [RESPONSE_MARKER_HEADER]: RELAYED_MARKER });
  const contentType = upstream.headers.get("content-type");
  const retryAfter = upstream.headers.get("retry-after");
  if (contentType !== null) headers.set("content-type", contentType);
  if (retryAfter !== null) headers.set("retry-after", retryAfter);
  return new Response(body, { status: upstream.status, headers });
}

/** This service's own refusal: marked, reasoned, and never confusable with an upstream answer. */
function refusal(reason: RefusalReason, status: number): Response {
  return new Response(JSON.stringify({ refusedBy: "anitabi-egress", reason }), {
    status,
    headers: {
      "content-type": "application/json",
      [RESPONSE_MARKER_HEADER]: REFUSED_MARKER,
      [REFUSAL_HEADER]: reason,
    },
  });
}
