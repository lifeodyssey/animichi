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
 *
 * The STEP half is what §十 10.2 adds (E-2 #1381): the settled steps of the
 * runs THIS PAGE shows, each carrying the params its tool executed with. It
 * rides this surface rather than the stream because the stream already carries
 * the other witness — the model's own arguments — and a metric that compared
 * that record with itself would be scoring the agent's self-statement. Nothing
 * about the ownership check changes: the params of a session's steps go to the
 * session's owner, on the same terms as its transcript, and `run_steps` stays
 * ungranted to `readonly`.
 */
import type {
  GetSessionHistoryResponse,
  SessionHistoryStep,
  SessionRunStatus,
} from "@animichi/contract/session-history-contract";
import type { RunFailureReason } from "../../db/schema.ts";
import { issuingRunOf } from "./issuing-run.ts";
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

/**
 * One settled tool step of one of the session's runs, as the store holds it
 * (E-2 #1381).
 *
 * `params` is `run_steps.input` — what the tool EXECUTED with, after pi
 * validated and coerced the model's arguments — as JSON text, which is the
 * form the column is read in and the form the surface publishes. The model's
 * own arguments are not here and are not this surface's to publish: they went
 * out live on the SD-9 stream (`tool-input-available.input`), and the point of
 * the pair is that the two records have different authors.
 */
export interface SettledStepRow {
  readonly runId: string;
  readonly stepIndex: number;
  readonly toolName: string;
  readonly params: string;
}

/** The read seam: the session's facts, one window of its transcript, and the
 * steps the named runs settled. */
export interface ConversationRecords {
  factsOf(sessionId: string): Promise<ConversationFacts | null>;
  transcriptOf(sessionId: string, page: TranscriptPage): Promise<TranscriptRow[]>;
  settledStepsOf(sessionId: string, runIds: readonly string[]): Promise<SettledStepRow[]>;
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

/** One settled step as the surface publishes it, under the run that numbered
 * it — the pairing is by `(run_id, step_index)`, never by position. */
function publishedStep(row: SettledStepRow): SessionHistoryStep {
  return {
    run_id: row.runId,
    step_index: row.stepIndex,
    tool_name: row.toolName,
    params: row.params,
  };
}

/** The window as it will be published: ordered here rather than trusted from
 * the store, then cut to the page the extra row overshot. */
function orderedPage(rows: TranscriptRow[], page: TranscriptPage): TranscriptRow[] {
  return [...rows].sort(ascendingByCreatedAt).slice(0, page.limit);
}

/**
 * The runs whose steps this page may answer for: the ones that issued the
 * calls ON it, plus the session's latest run.
 *
 * The transcript is paginated and `run_steps` is not, so the scope has to come
 * from somewhere; the page's own rows are the honest answer, since a step
 * nobody can see a call for on this page answers no question the page raises.
 * The latest run rides along unconditionally because it is the run this
 * surface EXISTS for — a client that left mid-turn comes back for exactly that
 * one, and `packages/eval` pairs its frames with `run.run_id`'s steps — and it
 * may have committed no message this page shows.
 */
function scopedRunIds(facts: ConversationFacts, rows: readonly TranscriptRow[]): string[] {
  const scoped = new Set(rows.flatMap((row) => issuingRunOf(row) ?? []));
  if (facts.latestRun !== null) scoped.add(facts.latestRun.runId);
  return [...scoped];
}

/** Everything one read gathered, before it is shaped into the payload. */
interface ReadSession {
  readonly facts: ConversationFacts;
  readonly ordered: readonly TranscriptRow[];
  readonly hasMore: boolean;
  readonly steps: readonly SettledStepRow[];
}

function historyOf(read: ReadSession, page: TranscriptPage): GetSessionHistoryResponse {
  return {
    messages: read.ordered.map(transcriptMessage),
    revision: read.facts.turnCount,
    next_offset: nextOffset(page, read.hasMore),
    run: runStatus(read.facts.latestRun),
    steps: read.steps.map(publishedStep),
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
  const rows = await windowOf(records, request, page);
  const ordered = orderedPage(rows, page);
  const steps = await records.settledStepsOf(request.sessionId, scopedRunIds(facts, ordered));
  return historyOf({ facts, ordered, hasMore: rows.length > page.limit, steps }, page);
}
