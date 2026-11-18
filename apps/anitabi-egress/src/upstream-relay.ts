/**
 * The relay: one upstream exchange, the last stage of the request path that
 * `egress-service.ts` composes, reached only once a request has been routed,
 * authenticated and counted (#1792). It asks the one URL this service built,
 * through the injected fetch and never redirected off it, and answers with the
 * upstream's answer verbatim, marked as the upstream's. An answer it cannot
 * deliver is refused as `upstream-timeout`, with a `detail` naming why when
 * the answer did arrive: a body past the limit, or a status a response cannot
 * have.
 */
import { refusal, RELAYED_MARKER, RESPONSE_MARKER_HEADER } from "./response-marking.ts";
import {
  upstreamUrlFor,
  UPSTREAM_USER_AGENT,
  type EgressOperation,
} from "./upstream-operations.ts";

/**
 * The relay's two `upstream-timeout` refusals of an answer that did arrive,
 * told apart in the body's `detail` for the reason `CEILING_STORE_DETAIL`
 * gives in `egress-service.ts`: its body passed the limit, or its status is
 * one a response cannot carry.
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

/** The handler's dependencies, as far as the relay reads them: the upstream fetch surface alone. */
interface RelayDeps {
  upstreamFetch: UpstreamFetch;
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

/** The upstream's answer as it arrived: its status, its headers and its whole body. */
interface DeliveredAnswer {
  readonly status: number;
  readonly headers: UpstreamResponseLike["headers"];
  readonly body: Uint8Array;
}

/** Relay the upstream's answer to the operation, or refuse when it delivered none this service can carry. */
export async function relay(deps: RelayDeps, operation: EgressOperation): Promise<Response> {
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
async function deliveredAnswer(deps: RelayDeps, operation: EgressOperation): Promise<DeliveredAnswer | Response> {
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
function askUpstream(deps: RelayDeps, operation: EgressOperation): Promise<UpstreamResponseLike> {
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
