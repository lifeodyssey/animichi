/**
 * What the agent tier answers a caller with (W1-7 #1256) — the wire half of the
 * route switch, kept apart from the composition so every shape here can be read
 * against the Python route it replaces.
 *
 * The flag is a FALLBACK flag: the same client code talks to whichever tier is
 * selected, so none of these shapes is new. Each names the Python site it is
 * read off:
 *  - the input refusals → `chat_body.py` / `error_messages.py` (`{detail}`, 422);
 *  - the quota refusal → `routes/admission.py::_quota_exhausted_response`, whose
 *    code and `quota_resets_at` payload are pinned by `packages/contract`'s
 *    `error-registry.ts` (403 + `action: "login"`, deliberately not a 429);
 *  - the busy refusal → `admission.py`'s `turn_in_flight` 409;
 *  - both "conversation not found" answers → `chat.py` (`{detail}`) and
 *    `conversations.py` (`{error}`), which differ in Python and are not
 *    unified here: unifying them would be a wire change hiding inside a
 *    routing change.
 */
import type { GetSessionHistoryResponse } from "@animichi/contract/agent-contract";
import type { ByokRejection } from "../agent/byok/byok-credential.ts";
import type { ByokProbeVerdict } from "../agent/byok/byok-probe.ts";
import type { ChatEnvelopeError } from "./chat-envelope.ts";

/**
 * The per-identity quota rejection code, mirrored rather than imported: it
 * lives in `packages/contract/src/error-registry.ts` beside a zod payload
 * schema, and that module cannot be imported here without pulling zod into the
 * Worker bundle (`packages/contract/AGENTS.md`). Same trade the budget breaker
 * already makes in `protect/cost-breaker.ts`; `test/agent-turn-wire.test.ts`
 * reads the contract file so the two literals cannot drift silently.
 */
const ANON_QUOTA_EXHAUSTED_CODE = "anon_quota_exhausted";

/** Verbatim from `routes/admission.py`. */
const QUOTA_EXHAUSTED_MESSAGE = "今日はここまで・ログインすると続けられるよ。";
const TURN_IN_FLIGHT_MESSAGE = "リクエストを処理中です。しばらくしてからお試しください。";
const CONVERSATION_NOT_FOUND_MESSAGE = "Conversation not found.";

/** Verbatim from `routes/admission.py`'s `BYOK_REQUIRES_LOGIN_MESSAGE`, which
 * `routes/byok.py` repeats word for word. */
const BYOK_REQUIRES_LOGIN_MESSAGE = "BYOKを使うにはログインが必要です。";

/** Verbatim from `routes/byok.py`'s missing-header rejection. */
const BYOK_HEADERS_REQUIRED_MESSAGE = "X-BYOK-* headers are required.";

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

/** A body the tier could not read as a turn. */
export function envelopeRefused(error: ChatEnvelopeError): Response {
  return jsonResponse({ detail: error.detail }, 422);
}

/** The per-identity daily allowance is spent; `quota_resets_at` says until when. */
export function quotaExhausted(resetsAt: string): Response {
  return jsonResponse({
    error: {
      code: ANON_QUOTA_EXHAUSTED_CODE,
      message: QUOTA_EXHAUSTED_MESSAGE,
      action: "login",
      data: { quota_resets_at: resetsAt },
    },
  }, 403);
}

/** The session already has a running turn (`runs_one_running_per_session`). */
export function turnInFlight(): Response {
  return jsonResponse({ error: { code: "turn_in_flight", message: TURN_IN_FLIGHT_MESSAGE } }, 409);
}

/** The conversation a turn named is not this identity's — `chat.py`'s answer. */
export function conversationNotFound(): Response {
  return jsonResponse({ detail: CONVERSATION_NOT_FOUND_MESSAGE }, 404);
}

/** The same fact on the retrieval surface — `conversations.py`'s answer. */
export function transcriptNotFound(): Response {
  return jsonResponse(
    { error: { code: "not_found", message: CONVERSATION_NOT_FOUND_MESSAGE } },
    404,
  );
}

/** A `limit`/`offset` the retrieval route refuses, as FastAPI's `Query` did. */
export function invalidPage(detail: string): Response {
  return jsonResponse({ detail }, 422);
}

/** One owned page of a conversation plus its latest run's state. */
export function transcriptPage(history: GetSessionHistoryResponse): Response {
  return jsonResponse(history, 200);
}

/** The SD-9 protocol marker `apps/web`'s `useChat` reads off a chat response. */
export const UI_MESSAGE_STREAM_HEADER = "x-vercel-ai-ui-message-stream";

/** The session a turn was committed on, named on the response.
 *
 * NEW on this tier, and it has to be: the web learns its session id from the
 * `data-response` part on the Python tier, and this tier's part does not carry
 * one. `session/turn-answer-part.ts` projects the answer from what the TURN
 * produced (#1283) — the session id is the intake's, not the answer's, and
 * threading it into a payload the model's own answer fills would put request
 * routing inside the response vocabulary. This header is therefore how a first
 * turn tells the client which conversation to come back to, which is exactly
 * what §二's disconnect semantics require of it. The 202 body carries the same
 * id for the same reason. */
export const SESSION_ID_HEADER = "x-session-id";

/**
 * Re-stamp a handed-back turn response with the two headers the caller needs.
 * A Durable Object's response headers are immutable, so this rebuilds the
 * envelope around the same body — the stream is passed through, never drained.
 */
export function turnResponse(handed: Response, sessionId: string): Response {
  const headers = new Headers(handed.headers);
  headers.set(SESSION_ID_HEADER, sessionId);
  if (headers.get("content-type")?.startsWith("text/event-stream") === true) {
    headers.set(UI_MESSAGE_STREAM_HEADER, "v1");
  }
  return new Response(handed.body, { status: handed.status, headers });
}

/**
 * A BYOK credential this tier will not use — `byok_models.py`'s `ByokError`
 * and the probe's `ProbeRejection`, which Python answers with the same 400
 * error envelope. The rejection's egress `reason` is deliberately NOT on this
 * wire: which red line a URL tripped is an oracle refinement, and Python
 * collapses every egress refusal to one sentence for the same reason.
 */
export function byokRefused(rejection: ByokRejection): Response {
  return jsonResponse({ error: { code: rejection.code, message: rejection.message } }, 400);
}

/** The probe with no headers at all — `routes/byok.py`'s own 400. */
export function byokHeadersRequired(): Response {
  return jsonResponse(
    { error: { code: "invalid_request", message: BYOK_HEADERS_REQUIRED_MESSAGE } },
    400,
  );
}

/** BYOK is login-gated on both routes that accept it (`turn_admission.py`
 * for the turn, `routes/byok.py` for the probe): 403, never a 401, because
 * the caller HAS an identity — it is just not one that may spend a key. */
export function byokRequiresLogin(): Response {
  return jsonResponse(
    { error: { code: "byok_requires_login", message: BYOK_REQUIRES_LOGIN_MESSAGE } },
    403,
  );
}

/** One probe's verdict, in the contract's `ByokProbeResponse` shape. */
export function byokProbed(verdict: ByokProbeVerdict): Response {
  return jsonResponse(verdict, 200);
}
