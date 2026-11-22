import { withRequestId } from "./request-id.ts";
import { internalError } from "./responses.ts";

/**
 * The gateway's request records (EDGE-1 #963, EG-06 #1343): one entry record
 * before a route serves anything, one completion record after, and one error
 * record when the serving threw. Each names the request by the class of the
 * route that answered it, and never by its path.
 */

/** What the records call a request: the class of the route that answered it. */
export type RequestClass = "landing" | "public-catalog" | "users" | "adopt" | "v1" | "retired" | "not-found";

/** Structured, credential-free request record (EDGE-1 #963): identity kind
 * (class), upstream status, duration and the request ID only — never a token,
 * trusted header, user identifier, path or payload. */
function observe(requestClass: RequestClass, status: number, startedMs: number): void {
  console.warn(JSON.stringify(withRequestId({
    event: "edge_gateway_request",
    class: requestClass,
    status,
    duration_ms: Date.now() - startedMs,
  })));
}

/** Entry-side counterpart to `observe`, logged BEFORE the route serves: without
 * it a request whose response never lands (mid-flight cancel) leaves no trace at
 * all. Route class, method and request ID only — pathnames carry identifiers
 * (`/v1/conversations/{session_id}`), so they stay out of logs. */
function observeEntry(requestClass: RequestClass, request: Request): void {
  console.warn(JSON.stringify(withRequestId({
    event: "edge_gateway_request_start",
    class: requestClass,
    method: request.method,
  })));
}

/** Every request leaves a completion record, including one whose serving threw
 * (EG-06): a failure that is invisible in the request stream is the one failure
 * nobody can find. A throw is recorded as the status `gatewayFailure` will
 * answer with, then rethrown for `app.onError` to answer. */
async function observed(
  requestClass: RequestClass, startedMs: number, serve: () => Promise<Response>,
): Promise<Response> {
  let status = GATEWAY_FAILURE_STATUS;
  try {
    const response = await serve();
    status = response.status;
    return response;
  } finally {
    observe(requestClass, status, startedMs);
  }
}

const GATEWAY_FAILURE_STATUS = 500;

/** Serve a request between its entry and completion records. */
export function recorded(
  requestClass: RequestClass, request: Request, serve: () => Promise<Response>,
): Promise<Response> {
  observeEntry(requestClass, request);
  return observed(requestClass, Date.now(), serve);
}

/** The Worker's last line (EG-06). Hono's default for an unhandled throw is a
 * plain-text 500 outside every envelope, so `app.onError` routes here instead:
 * one structured record — route class, status and the error's NAME, never its
 * message, which is a server-side string that may carry a DSN or a stack — and
 * the same rejection envelope as every deliberate refusal. */
export function gatewayFailure(error: unknown, requestClass: RequestClass): Response {
  console.warn(JSON.stringify(withRequestId({
    event: "edge_gateway_error",
    class: requestClass,
    status: GATEWAY_FAILURE_STATUS,
    error: error instanceof Error ? error.name : "unknown",
  })));
  return internalError();
}
