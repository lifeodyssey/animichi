/**
 * `ConversationRetrieval` — the "取回面" of the turn lifecycle (W1-5 #1254,
 * spec `docs/specs/2026-09-01-agent-ts-rewrite-spec.md` §二 "断线语义"): a
 * client that left mid-turn never resumes the stream, it comes back and pulls
 * the session once by id through `GET /v1/conversations/{id}/messages`.
 *
 * WHY THIS IS ITS OWN DIRECTORY AND NOT `session/`: every sibling here is one
 * moment of a turn — `intake/` a turn STARTS, `session/` a turn RUNS inside the
 * Durable Object's alarm, `settlement/` a turn ENDS, `sweeper/` a stranded turn
 * is rescued. Reading a session back is a fifth one, and it belongs to none of
 * the others: it runs in the WORKER and never in the Durable Object, it holds
 * no lease and writes nothing, and its only tie to a run is that it reports the
 * status the settlement wrote. Putting it in `session/` would put a read path
 * the DO never executes into the DO's module graph.
 *
 * The transcript half is a PORT of the Python use case
 * (`apps/agent/src/animichi/application/get_session_history.py`), which the
 * fallback flag (#1256) keeps serving this path until it flips — so the wire
 * the web sees must not move. This module keeps that use case's three
 * responsibilities: it is the ORDERING authority (ascending `created_at`, done
 * here rather than trusted from the store), the OWNERSHIP check (missing and
 * forbidden collapse to the same absent answer, so ownership is not
 * observable), and the PAGINATION computation.
 *
 * The run half is what §三 adds: the state of the session's latest run.
 */
import type { GetSessionHistoryResponse, SessionRunStatus } from "@animichi/contract/agent-contract";
import type { RunFailureReason } from "../../db/schema.ts";
import { transcriptMessage, type TranscriptRow } from "./transcript-message.ts";

export type { TranscriptRow } from "./transcript-message.ts";

/** The page the Python route's `limit` query parameter defaults to and caps at. */
export const TRANSCRIPT_PAGE_LIMIT = 100;

/** The furthest `offset` that route accepts, and therefore the furthest one
 * this surface will ever hand back as a next page. */
export const TRANSCRIPT_OFFSET_BOUND = 1_000;

/** One window of a transcript, as the store is asked for it. */
export interface TranscriptPage {
  readonly limit: number;
  readonly offset: number;
}

/** The state of one session's latest run, as the store holds it. */
export interface LatestRun {
  readonly runId: string;
  readonly status: SessionRunStatus["status"];
  readonly failureReason: RunFailureReason | null;
}

/**
 * Everything about a session that is not its transcript: who owns it, how many
 * turns it has committed, and the run it opened last. Read together because
 * they answer one question — "may this identity read this session, and what is
 * it doing right now" — and one round trip is the whole point.
 */
export interface ConversationFacts {
  readonly ownerId: string | null;
  readonly turnCount: number;
  readonly latestRun: LatestRun | null;
}

/** The read seam: the session's facts, then one window of its transcript. */
export interface ConversationRecords {
  factsOf(sessionId: string): Promise<ConversationFacts | null>;
  transcriptOf(sessionId: string, page: TranscriptPage): Promise<TranscriptRow[]>;
}

/** One retrieval: which session, on whose behalf, and which window of it. */
export interface ConversationRequest {
  readonly sessionId: string;
  readonly identityId: string;
  readonly limit?: number;
  readonly offset?: number;
}

/** The identity may read the session only when it is the session's owner. An
 * unowned session belongs to nobody, so knowing its id buys nothing. */
function ownedBy(facts: ConversationFacts, identityId: string): boolean {
  return facts.ownerId !== null && facts.ownerId === identityId;
}

/** The offset of the next page, or none — there is no next page, or it lies
 * past the bound the route itself refuses. */
function nextOffset(page: TranscriptPage, hasMore: boolean): number | null {
  const next = page.offset + page.limit;
  if (!hasMore || next > TRANSCRIPT_OFFSET_BOUND) return null;
  return next;
}

/** The contract's run field, or `null` for a session that never opened one. */
function runStatus(latest: LatestRun | null): SessionRunStatus | null {
  if (latest === null) return null;
  return { run_id: latest.runId, status: latest.status, reason: latest.failureReason };
}

function ascendingByCreatedAt(left: TranscriptRow, right: TranscriptRow): number {
  return left.createdAt < right.createdAt ? -1 : Number(left.createdAt > right.createdAt);
}

function pageOf(request: ConversationRequest): TranscriptPage {
  return { limit: request.limit ?? TRANSCRIPT_PAGE_LIMIT, offset: request.offset ?? 0 };
}

/** The window plus one row: the extra row is how "there is more" is known
 * without a second count query (the Python use case's own trick). */
async function windowOf(
  records: ConversationRecords,
  request: ConversationRequest,
  page: TranscriptPage,
): Promise<TranscriptRow[]> {
  return await records.transcriptOf(request.sessionId, { ...page, limit: page.limit + 1 });
}

function historyOf(
  facts: ConversationFacts,
  page: TranscriptPage,
  rows: TranscriptRow[],
): GetSessionHistoryResponse {
  const ordered = [...rows].sort(ascendingByCreatedAt).slice(0, page.limit);
  return {
    messages: ordered.map(transcriptMessage),
    revision: facts.turnCount,
    next_offset: nextOffset(page, rows.length > page.limit),
    run: runStatus(facts.latestRun),
  };
}

/**
 * One owned, ordered page of a session plus the state of its latest run, or
 * `null` when the session is missing OR belongs to someone else — the caller
 * answers both with the same 404, which is what keeps ownership unobservable.
 */
export async function readConversation(
  records: ConversationRecords,
  request: ConversationRequest,
): Promise<GetSessionHistoryResponse | null> {
  const facts = await records.factsOf(request.sessionId);
  if (facts === null || !ownedBy(facts, request.identityId)) return null;
  const page = pageOf(request);
  return historyOf(facts, page, await windowOf(records, request, page));
}
