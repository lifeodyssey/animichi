/**
 * The request handler: the whole service between authentication and relay
 * (#1792). Order is fixed and load-bearing:
 *
 *   route  — only the two named operations exist; anything else is refused
 *   config — a service without its key or ceiling refuses everything
 *   auth   — the signature is verified BEFORE the ceiling, so unauthenticated
 *            traffic cannot spend a single upstream slot
 *   ceiling— our promise to the upstream, enforced regardless of the caller,
 *            and counted in an external store since #1810 so a restart inside
 *            the upstream's hour cannot start a second one
 *   relay  — the upstream's answer, verbatim, marked as the upstream's, asked
 *            from the one URL this service built and never redirected off it;
 *            an answer a response cannot carry is refused as `upstream-timeout`,
 *            with a `detail` naming why: a body past the limit, or a status a
 *            response cannot have
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
import type { CeilingDecision } from "./upstream-ceiling.ts";
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

/**
 * Why the ceiling refused, when the reason alone does not say: the store
 * holding this hour's count could not be reached, so the service refused
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
 * The relay's two `upstream-timeout` refusals of an answer that did arrive,
 * told apart in the body's `detail` for the reason given above: its body
 * passed the limit, or its status is one a response cannot carry.
 */
const UPSTREAM_BODY_OVER_LIMIT_DETAIL = "upstream-body-over-limit";
const UPSTREAM_STATUS_NOT_RELAYABLE_DETAIL = "upstream-status-not-relayable";

/** The upstream fetch surface; the real service passes global `fetch`. */
export type UpstreamFetch = (
  url: string,
  init?: {
    headers?: Record<string, string>;
    signal?: AbortSignal;
    /**
     * Required, and only ever `"error"`. Global `fetch` follows a `Location`
     * by default, which would let the upstream turn the one URL this service
     * builds into a second destination nobody reviewed; stating the policy in
     * the seam's own type is what keeps a caller from omitting it and
     * inheriting the permissive default. `"follow"` and `"manual"` are not
     * accepted here at all (#1806).
     */
    redirect: "error";
  },
) => Promise<UpstreamResponseLike>;

/** The part of a fetch Response the relay needs. The body is read as it arrives, never asked for whole. */
export interface UpstreamResponseLike {
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  readonly body: AsyncIterable<Uint8Array> | null;
}

/**
 * The hourly upstream-request budget; UpstreamRequestCeiling satisfies it.
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

/** Give the upstream a fair chance to answer before we fail closed. */
const UPSTREAM_TIMEOUT_MS = 10_000;

/**
 * The most of an upstream body this service holds. The relay reads the body as
 * it arrives and gives the rest up once it passes this, so no answer is held
 * whole whatever its size; the timeout above bounds only how long it may take.
 * The measured scale is at most 600 points per work, so the limit allows about
 * 14 KB for each point.
 */
const UPSTREAM_BODY_LIMIT_BYTES = 8 * 1024 * 1024;

/** The statuses a response carries no body on (the Fetch standard's null body statuses) inside the range a response may have. */
const NULL_BODY_STATUSES: ReadonlySet<number> = new Set([204, 205, 304]);

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
  if (method === "GET") return null;
  const refused = refusal("method-not-allowed", 405);
  refused.headers.set("allow", "GET");
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
 * not retry it in-request. Whether this hour's budget ran out or the counter
 * storing it was unreachable is an operator's question, and the body answers it.
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

/** The upstream's answer as it arrived: its status, its headers and its whole body. */
interface DeliveredAnswer {
  readonly status: number;
  readonly headers: UpstreamResponseLike["headers"];
  readonly body: Uint8Array;
}

/** Relay the upstream's answer to the operation, or refuse when it delivered none this service can carry. */
async function relay(deps: EgressDeps, operation: EgressOperation): Promise<Response> {
  const answer = await deliveredAnswer(deps, operation);
  if (answer instanceof Response) return answer;
  if (!carriable(answer)) return refusal("upstream-timeout", 504, UPSTREAM_STATUS_NOT_RELAYABLE_DETAIL);
  return relayed(answer);
}

/**
 * The upstream's whole answer, or the refusal it gets when it delivered none:
 * the request failed, the body broke off, or the body passed the limit.
 *
 * The body is read here, inside the same guard: arriving headers are not a
 * delivered answer, and a reset or stalled stream rejects while it is read.
 * Outside the guard, that rejection would escape the handler and the caller
 * would get no response at all rather than our marked refusal.
 */
async function deliveredAnswer(deps: EgressDeps, operation: EgressOperation): Promise<DeliveredAnswer | Response> {
  try {
    const upstream = await askUpstream(deps, operation);
    const body = await bodyWithin(upstream.body, UPSTREAM_BODY_LIMIT_BYTES);
    if (body === null) return refusal("upstream-timeout", 504, UPSTREAM_BODY_OVER_LIMIT_DETAIL);
    return { status: upstream.status, headers: upstream.headers, body };
  } catch {
    return refusal("upstream-timeout", 504);
  }
}

/** The one upstream request: the URL the operation names, this service's User-Agent, its timeout, and no redirect. */
function askUpstream(deps: EgressDeps, operation: EgressOperation): Promise<UpstreamResponseLike> {
  return deps.upstreamFetch(upstreamUrlFor(operation), {
    headers: { "user-agent": UPSTREAM_USER_AGENT },
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    // The one URL the service built, and no other: a `Location` header would
    // otherwise move the connection to a host nothing here chose.
    redirect: "error",
  });
}

/**
 * The whole body, or null as soon as it passes `limit`. Leaving the loop early
 * cancels the stream, so the rest of an oversize answer is never read and the
 * connection carrying it is given up.
 */
async function bodyWithin(body: AsyncIterable<Uint8Array> | null, limit: number): Promise<Uint8Array | null> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of body ?? []) {
    size += chunk.byteLength;
    if (size > limit) return null;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size);
}

/**
 * Whether a response can carry the answer as it arrived: a status in the range
 * a response may have, and no body on a status that has none. The `Response`
 * constructor throws on anything else, outside the guard that read the answer,
 * so the relay refuses such an answer as one it could not deliver.
 */
function carriable(answer: DeliveredAnswer): boolean {
  const inRange = answer.status >= 200 && answer.status <= 599;
  return inRange && (answer.body.byteLength === 0 || !NULL_BODY_STATUSES.has(answer.status));
}

/** The answer as this service relays it: status and body verbatim, content type and retry hint forwarded, marked as the upstream's. */
function relayed(answer: DeliveredAnswer): Response {
  const headers = new Headers({ [RESPONSE_MARKER_HEADER]: RELAYED_MARKER });
  const contentType = answer.headers.get("content-type");
  const retryAfter = answer.headers.get("retry-after");
  if (contentType !== null) headers.set("content-type", contentType);
  if (retryAfter !== null) headers.set("retry-after", retryAfter);
  return new Response(answer.body.byteLength === 0 ? null : answer.body, { status: answer.status, headers });
}

/** What a caller reads off our refusal without parsing prose: whose it is, why, and the detail when there is one. */
interface RefusalBody {
  readonly refusedBy: "anitabi-egress";
  readonly reason: RefusalReason;
  readonly detail?: string;
}

/** This service's own refusal: marked, reasoned, and never confusable with an upstream answer. */
function refusal(reason: RefusalReason, status: number, detail?: string): Response {
  const body: RefusalBody = detail === undefined
    ? { refusedBy: "anitabi-egress", reason }
    : { refusedBy: "anitabi-egress", reason, detail };
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      [RESPONSE_MARKER_HEADER]: REFUSED_MARKER,
      [REFUSAL_HEADER]: reason,
    },
  });
}
