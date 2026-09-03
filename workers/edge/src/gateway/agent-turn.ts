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
import { ChatEnvelopeError, chatTurnText, requestLocale, type Locale } from "./chat-envelope.ts";
import {
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

/** A conversation id is a primary key that arrives in a header — bounded here
 * so a caller cannot mint an arbitrarily large one. */
const SESSION_ID_MAX_CHARS = 200;

/** The identity the edge already verified, as the agent tier consumes it. */
export interface TurnIdentity {
  readonly userId: string;
  readonly userType: string;
}

/** What the gateway asks the agent tier to answer. */
export interface AgentTurnTier {
  chat(env: Env, request: Request, identity: TurnIdentity): Promise<Response>;
  transcript(env: Env, request: Request, identity: TurnIdentity, sessionId: string): Promise<Response>;
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

/** The turn's own conversation: the one the caller named, or a fresh one. */
function submittedSessionId(raw: string | null, locale: Locale): string {
  const named = raw?.trim() ?? "";
  if (named === "") return crypto.randomUUID();
  if (named.length > SESSION_ID_MAX_CHARS) throw new ChatEnvelopeError("invalid_body", locale);
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
 */
export async function submissionOf(
  request: Request, identity: TurnIdentity, locale: Locale, maxChars: number = MESSAGE_MAX_CHARS,
): Promise<TurnSubmission> {
  const payload = await submittedPayload(request, locale);
  return {
    sessionId: submittedSessionId(request.headers.get("x-session-id"), locale),
    identityId: identity.userId,
    payer: identity.userType === "anonymous" ? "anon" : "user",
    clientMessageId: request.headers.get("x-turn-id")?.trim() ?? crypto.randomUUID(),
    text: chatTurnText(payload, locale, maxChars),
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
  const locale = requestLocale(request.headers.get("x-locale"));
  const submission = await submissionOf(request, identity, locale, MESSAGE_MAX_CHARS);
  return turnResponse(await handOff(env, submission), submission.sessionId);
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

/** The production tier: Neon for the turn tables, the DOs for the run itself. */
export function neonAgentTurnTier(): AgentTurnTier {
  return {
    chat: (env, request, identity) => refusable(() => chatResponse(env, request, identity)),
    transcript: (env, request, identity, sessionId) =>
      refusable(() => transcriptResponse(env, request, identity, sessionId)),
  };
}
