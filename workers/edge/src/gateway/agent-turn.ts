/// <reference types="@cloudflare/workers-types" />

/**
 * The two `/v1` routes this Worker serves ITSELF once `AGENT_TURN_ROUTE` says
 * `edge` (W1-7 #1256, spec `docs/specs/2026-09-01-agent-ts-rewrite-spec.md` §三):
 * `POST /v1/chat` becomes a durable turn handed to the session's Durable Object,
 * and `GET /v1/conversations/{id}/messages` is read straight out of Neon.
 *
 * This module is the COMPOSITION and nothing else — every piece it wires was
 * built and proven by an earlier card (`intake/`, `session/`, `retrieval/`), and
 * the pieces stay unaware of HTTP. What lives here is the part only a route can
 * own: which identity a submission carries (the edge already verified it —
 * AUTH-2 #950 — so nothing below re-reads a header for identity), which
 * conversation it belongs to, and which refusal a caller is told about.
 *
 * `AgentTurnTier` is a port so the gateway seam can be driven under `node:test`
 * without a database or a Durable Object; `neonAgentTurnTier()` is the one
 * production implementation, wired in `app.ts` beside the other gates.
 */
import type { Env } from "../env.ts";
import type { RunPayer } from "../db/schema.ts";
import type { NamedStubs } from "../agent/durable-namespace.ts";
import { withAgentDatabase } from "../db/agent-database.ts";
import { anonymousMessageAllowance, QuotaExhaustedError } from "../agent/intake/anonymous-message-allowance.ts";
import { NeonTurnRecords } from "../agent/intake/neon-turn-records.ts";
import { SessionBusyError, SessionOwnershipError, type TurnSubmission } from "../agent/intake/turn-intake.ts";
import { durableRunBackstop } from "../agent/sweeper/run-backstop.ts";
import { durableSessionWakeup } from "../agent/session/session-wakeup.ts";
import { durableSessionStreams, handOffTurn } from "../agent/session/turn-stream-handoff.ts";
import { readConversationOn } from "../agent/retrieval/neon-conversation-records.ts";
import { TRANSCRIPT_OFFSET_BOUND, TRANSCRIPT_PAGE_LIMIT } from "../agent/retrieval/conversation-retrieval.ts";
import { ByokRejection, type ByokCredential } from "../agent/byok/byok-credential.ts";
import { byokCredentialIn, byokSignalIn } from "../agent/byok/byok-headers.ts";
import { ByokProbe } from "../agent/byok/byok-probe.ts";
import { selectionIn } from "../agent/selection/selection-request.ts";
import { ChatEnvelopeError, chatTurnText, requestLocale, type Locale } from "./chat-envelope.ts";
import {
  byokHeadersRequired,
  byokProbed,
  byokRefused,
  byokRequiresLogin,
  conversationNotFound,
  envelopeRefused,
  invalidPage,
  quotaExhausted,
  transcriptNotFound,
  transcriptPage,
  turnInFlight,
  turnResponse,
} from "./agent-turn-responses.ts";

/**
 * The message-length ceiling (S1.12, finalized 2026-07-07 in
 * `docs/specs/2026-07-06-frontend-rebuild-spec.md`). A constant and not a
 * fourth environment variable: `MESSAGE_MAX_CHARS` was never set in
 * `wrangler.toml`, so the container has been running on this same default
 * (`Settings.message_max_chars`) all along, and a var nobody sets is a
 * touchpoint that only drifts.
 */
export const MESSAGE_MAX_CHARS = 4_000;

/** A conversation id is a primary key that arrives in a header, and the dedupe
 * key is a uniquely-indexed column that arrives in another — both bounded here
 * so a caller cannot mint an arbitrarily large one. */
const HEADER_KEY_MAX_CHARS = 200;

/** The identity the edge already verified, as the agent tier consumes it. */
export interface TurnIdentity {
  readonly userId: string;
  readonly userType: string;
}

/** What the gateway asks the agent tier to answer. */
export interface AgentTurnTier {
  chat(env: Env, request: Request, identity: TurnIdentity): Promise<Response>;
  /** No `env`: a probe reads no binding — it spends the caller's own key
   * against the caller's own endpoint and touches neither Neon nor a DO. */
  probe(request: Request, identity: TurnIdentity): Promise<Response>;
  transcript(env: Env, request: Request, identity: TurnIdentity, sessionId: string): Promise<Response>;
}

/**
 * BYOK is login-gated on both routes that accept it (`turn_admission.py`,
 * `routes/byok.py`). The check routes through the ID convention as well as the
 * typed marker, exactly as `application/identity.py::is_anonymous_identity`
 * does and for the same reason (#741): an `anon_`-prefixed id with a missing
 * or mistyped user type is anonymous too, and a literal type check would let
 * that caller reach a real credential-spending model call.
 */
function isAnonymousIdentity(identity: TurnIdentity): boolean {
  return identity.userType === "anonymous" || identity.userId.startsWith("anon_");
}

/**
 * Who pays for the turn — the `runs.payer` vocabulary, which is also
 * `daily_usage.scope` (`db/schema.ts`).
 *
 * A BYOK turn is its OWN payer, not the member who submitted it: the caller
 * spent their own key, so the settlement prices it at zero
 * (`settlement/neon-turn-settlement.ts::platformCost`) and banks it in the
 * `byok` scope. That is Python's `scope_for_identity(..., is_byok=True)`, which
 * checks BYOK first "even when it also happens to carry an anonymous-shaped
 * identity", and it is what the third value of `RUN_PAYERS` has been waiting
 * for — nothing set it before this card.
 */
function payerFor(identity: TurnIdentity, byok: ByokCredential | undefined): RunPayer {
  if (byok !== undefined) return "byok";
  return identity.userType === "anonymous" ? "anon" : "user";
}

/** Answered BEFORE the headers are parsed (Python's P3 ordering): a malformed
 * BYOK header from an anonymous caller must surface as the login refusal, not
 * as `invalid_request`. */
function byokLoginRefusal(request: Request, identity: TurnIdentity): Response | null {
  const gated = isAnonymousIdentity(identity) && byokSignalIn(request.headers);
  return gated ? byokRequiresLogin() : null;
}

/** A `limit`/`offset` outside the window the retrieval surface accepts. */
class TranscriptWindowError extends Error {
  readonly detail: string;

  constructor(detail: string) {
    super(detail);
    this.name = "TranscriptWindowError";
    this.detail = detail;
  }
}

function boundNamespace(binding: NamedStubs | undefined, name: string): NamedStubs {
  if (binding === undefined) throw new Error(`${name} is not bound`);
  return binding;
}

/**
 * A key the caller supplies in a header, or null when they supplied none
 * (EG-09, issue #1343). Blank counts as ABSENT — `""` is not nullish, so a
 * present-but-empty header would otherwise become a real key: the empty
 * `client_message_id` lands in `messages_session_client_message_id`'s partial
 * unique index and every later empty-id turn in that session resolves to the
 * first message as a "replay". Over the bound is a refusal rather than a
 * truncation: a key this long is not a key the caller can have meant.
 */
function boundedHeaderKey(headers: Headers, name: string, max: number, locale: Locale): string | null {
  const named = headers.get(name)?.trim() ?? "";
  if (named === "") return null;
  if (named.length > max) throw new ChatEnvelopeError("invalid_body", locale);
  return named;
}

async function submittedPayload(request: Request, locale: Locale): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ChatEnvelopeError("invalid_body", locale);
  }
}

/**
 * One submission out of one request. `x-turn-id` is the web's per-send turn
 * identifier (`apps/web/src/features/chat/session-headers.ts`) and therefore
 * the intake's dedupe key: a regenerate after a drop carries the same one, so
 * it resolves to the turn already committed instead of opening a second.
 *
 * A body carrying `selected_point_ids` or `selected_candidate_ids` is a
 * DETERMINISTIC selection (#1288) and may therefore have no utterance at all —
 * `apps/web` sends a part-less marker for a point recompute. The two facts are
 * read in that order for exactly that reason.
 */
export async function submissionOf(
  request: Request, identity: TurnIdentity, locale: Locale, maxChars: number = MESSAGE_MAX_CHARS,
): Promise<TurnSubmission> {
  const payload = await submittedPayload(request, locale);
  const byok = byokCredentialIn(request.headers) ?? undefined;
  const selection = selectionIn(payload, locale);
  return {
    sessionId: boundedHeaderKey(request.headers, "x-session-id", HEADER_KEY_MAX_CHARS, locale) ?? crypto.randomUUID(),
    identityId: identity.userId,
    payer: payerFor(identity, byok),
    clientMessageId: boundedHeaderKey(request.headers, "x-turn-id", HEADER_KEY_MAX_CHARS, locale) ?? crypto.randomUUID(),
    text: chatTurnText(payload, locale, maxChars, selection === null),
    byok,
    selection,
  };
}

/** Admit the turn and hand back the session's live view of it. */
function handOff(env: Env, submission: TurnSubmission): Promise<Response> {
  const sessions = boundNamespace(env.AGENT_SESSION, "AGENT_SESSION");
  const backstop = durableRunBackstop(boundNamespace(env.RUN_SWEEPER, "RUN_SWEEPER"));
  const allowance = anonymousMessageAllowance(env.ANON_DAILY_MESSAGE_QUOTA);
  return withAgentDatabase(env, (transactions) => handOffTurn({
    intake: {
      backstop,
      records: new NeonTurnRecords(transactions, allowance),
      wakeup: durableSessionWakeup(sessions, backstop),
    },
    streams: durableSessionStreams(sessions),
  }, submission));
}

async function chatResponse(env: Env, request: Request, identity: TurnIdentity): Promise<Response> {
  const refusal = byokLoginRefusal(request, identity);
  if (refusal !== null) return refusal;
  const locale = requestLocale(request.headers.get("x-locale"));
  const submission = await submissionOf(request, identity, locale, MESSAGE_MAX_CHARS);
  return turnResponse(await handOff(env, submission), submission.sessionId);
}

/**
 * One credential, validated and spent once (`routes/byok.py`). The login gate
 * runs first, then the headers must be there at all, and only then does the
 * probe make its single upstream request through the egress guard.
 */
async function probeResponse(
  probe: ByokProbe, request: Request, identity: TurnIdentity,
): Promise<Response> {
  const refusal = byokLoginRefusal(request, identity);
  if (refusal !== null) return refusal;
  const credential = byokCredentialIn(request.headers);
  if (credential === null) return byokHeadersRequired();
  return byokProbed(await probe.run(credential));
}

/** One query parameter as the Python route's `Query(ge=…, le=…)` accepted it. */
function boundedParameter(raw: string | null, fallback: number, low: number, high: number, name: string): number {
  if (raw === null) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < low || value > high) {
    throw new TranscriptWindowError(`${name} must be an integer between ${String(low)} and ${String(high)}`);
  }
  return value;
}

function transcriptWindow(parameters: URLSearchParams): { limit: number; offset: number } {
  return {
    limit: boundedParameter(parameters.get("limit"), TRANSCRIPT_PAGE_LIMIT, 1, TRANSCRIPT_PAGE_LIMIT, "limit"),
    offset: boundedParameter(parameters.get("offset"), 0, 0, TRANSCRIPT_OFFSET_BOUND, "offset"),
  };
}

async function transcriptResponse(
  env: Env, request: Request, identity: TurnIdentity, sessionId: string,
): Promise<Response> {
  const window = transcriptWindow(new URL(request.url).searchParams);
  const history = await withAgentDatabase(env, (transactions) =>
    readConversationOn(transactions, { sessionId, identityId: identity.userId, ...window }),
  );
  return history === null ? transcriptNotFound() : transcriptPage(history);
}

/**
 * The refusals this tier answers itself; anything else is a real failure and is
 * rethrown. Exported because it is the whole wire contract of the switch: every
 * response a caller can get instead of a turn is decided in this one function,
 * and it is where each shape is held against the Python route it replaces.
 */
export function refusalFor(error: unknown): Response | null {
  if (error instanceof ByokRejection) return byokRefused(error);
  if (error instanceof ChatEnvelopeError) return envelopeRefused(error);
  if (error instanceof QuotaExhaustedError) return quotaExhausted(error.resetsAt);
  if (error instanceof SessionOwnershipError) return conversationNotFound();
  if (error instanceof SessionBusyError) return turnInFlight();
  if (error instanceof TranscriptWindowError) return invalidPage(error.detail);
  return null;
}

async function refusable(work: () => Promise<Response>): Promise<Response> {
  try {
    return await work();
  } catch (error) {
    const refusal = refusalFor(error);
    if (refusal === null) throw error;
    return refusal;
  }
}

/** The production tier: Neon for the turn tables, the DOs for the run itself.
 * The probe is injectable so the seam runs under `node:test` against a
 * scripted socket instead of a caller's real provider. */
export function neonAgentTurnTier(probe: ByokProbe = new ByokProbe()): AgentTurnTier {
  return {
    chat: (env, request, identity) => refusable(() => chatResponse(env, request, identity)),
    probe: (request, identity) => refusable(() => probeResponse(probe, request, identity)),
    transcript: (env, request, identity, sessionId) =>
      refusable(() => transcriptResponse(env, request, identity, sessionId)),
  };
}
