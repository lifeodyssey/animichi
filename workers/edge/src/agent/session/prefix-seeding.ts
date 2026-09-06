/**
 * Seeding one frozen trajectory prefix into one session (E-1 #1380, spec §十
 * 10.1; 李博杰《深入理解 AI Agent》ch.7 `initialization_actions`).
 *
 * IT WRITES NOTHING OF ITS OWN. Every row it produces goes through the port a
 * real turn goes through — `TurnRecords.openTurn` for the session, the user
 * message and the run; `TurnStore` for the lease, the assistant tool-call
 * message, the `run_steps` row and the terminal settlement;
 * `SessionEnvelopeStore` for the state that outlives the turn. A second SQL
 * path would be a second definition of what a turn IS, and the whole value of a
 * seeded starting point is that the tier cannot tell it from a lived one.
 *
 * WHY IT RUNS INSIDE THE SESSION'S DURABLE OBJECT: the envelope lives in that
 * instance's own storage and nowhere else (`durable-envelope-store.ts` argues
 * the storage choice), and spec §三 makes the DO the single writer of session
 * state. There is no other place both halves of a prefix can be written.
 *
 * THREE REFUSALS, and none of them is `APP_ENV`. The mount switch decides where
 * this code EXISTS (`gateway/staging-prefix-route.ts`); it decides nothing about
 * who may call it. A prefix is refused when the session belongs to another
 * identity — indistinguishably from a session that does not exist, the rule
 * `ConversationRetrieval` already keeps — when the session has already taken a
 * turn, because a prefix is a session's FIRST turn and one written after a real
 * one would silently reorder the transcript, and when the run it opened cannot
 * be driven to a terminal row.
 *
 * IDEMPOTENT PER CASE, through the intake's own dedupe rather than a flag of
 * its own: the seeded user message is keyed by `prefix:<case_id>`, so the
 * partial unique index `messages_session_client_message_id` makes a second
 * seeding a replay that writes nothing and answers `seeded: false`.
 *
 * ONE WINDOW IS NOT RECOVERABLE, AND IT IS WRITTEN DOWN RATHER THAN GUARDED.
 * A crash or an eviction between `openedPrefixRun` and `settledPrefixRun`
 * leaves the session with a `running` run and no envelope: the singleton
 * `RunSweeper` will re-arm that run as a REAL turn — it reads the `runs` row,
 * which carries nothing marking it a seed — and a re-seeding will then find the
 * case's own message committed, answer `seeded: false`, and never promote the
 * clarification the case needs. The measured turn would run against a session
 * whose envelope is empty.
 *
 * A live turn recovers from this window because its alarm retries the whole
 * turn; a seeding has no alarm, so the equivalent guard would be a marker
 * column on `runs` plus a sweeper branch that skips it — DDL and a change to
 * the at-least-once backstop, for a failure mode that exists on one deployment
 * and shows up as a scored case rather than as silence (the seeded turn is
 * refused `SELECTION_EXPIRED`, which is loud in the report). The recovery is
 * therefore operational and stated here: DELETE THE SESSION and re-run the
 * case — `sessions` cascades to its messages and runs — or seed under a fresh
 * session id, which is what the harness does on every run anyway
 * (`packages/eval/src/prefix-seeding-lifecycle.ts` mints one per case).
 */
import type { RunPayer } from "../../db/schema.ts";
import { quotaReservationFor } from "../intake/quota-reservation.ts";
import {
  SessionOwnershipError,
  TURN_DEADLINE_MS,
  type TurnRecords,
} from "../intake/turn-intake.ts";
import { ownedBy, type ConversationFacts } from "../retrieval/conversation-retrieval.ts";
import type { UsagePrices } from "../settlement/turn-settlement.ts";
import { prefixAnswer, prefixEnvelope, prefixMessageKey, prefixStep, prefixSubmission } from "./prefix-turn.ts";
import { LEASE_SLICE_MS } from "./run-machine.ts";
import type { SessionEnvelopeStore } from "./session-envelope.ts";
import type { TrajectoryPrefix } from "./trajectory-prefix.ts";
import type { TurnStore } from "./turn-store.ts";

/**
 * What the seeding must know before it writes: who owns the session and how
 * many turns it has, plus whether this case's own prefix is already in it.
 *
 * The first half is `ConversationRecords.factsOf` — the read the retrieval
 * surface already answers ownership with — and the second is the one question
 * no existing read asks: it separates "this case has been seeded before" from
 * "someone has been talking in this session", which are the same `turnCount`
 * and opposite answers.
 */
export interface SeededSessionRecords {
  factsOf(sessionId: string): Promise<ConversationFacts | null>;
  carriesPrefix(sessionId: string, clientMessageId: string): Promise<boolean>;
}

/** A prefix is a session's FIRST turn; this one already has others. */
export class SessionNotEmptyError extends Error {
  constructor() {
    super("the session has already taken a turn");
    this.name = "SessionNotEmptyError";
  }
}

/** The run opened for the prefix could not be driven to its terminal row —
 * another writer holds its lease, or it is no longer running. Loud on purpose:
 * a half-written prefix is a starting point nothing can trust. */
export class PrefixNotWritableError extends Error {
  constructor(detail: string) {
    super(`the seeded run could not be written: ${detail}`);
    this.name = "PrefixNotWritableError";
  }
}

/** The collaborators one seeding drives, in the order it drives them. */
export interface PrefixSeedingParts {
  readonly records: SeededSessionRecords;
  readonly turns: TurnRecords;
  readonly store: TurnStore;
  readonly envelopes: SessionEnvelopeStore;
  /** The Durable Object incarnation taking the seeded run's lease. */
  readonly owner: string;
  readonly prices: UsagePrices;
  readonly now: () => number;
}

/** One seeding request: which session, on whose behalf, and what to write. */
export interface PrefixSeedingRequest {
  readonly sessionId: string;
  readonly identityId: string;
  readonly payer: RunPayer;
  readonly prefix: TrajectoryPrefix;
}

/** Whether the write happened, or the case's prefix was already there. */
export interface SeededPrefixReceipt {
  readonly seeded: boolean;
}

const ALREADY_SEEDED: SeededPrefixReceipt = { seeded: false };
const SEEDED_NOW: SeededPrefixReceipt = { seeded: true };

/** A session that may be seeded, or the reason it may not. `true` means this
 * case's prefix is already in it and the caller is done. */
async function alreadySeeded(
  parts: PrefixSeedingParts, request: PrefixSeedingRequest, facts: ConversationFacts,
): Promise<boolean> {
  if (!ownedBy(facts, request.identityId)) throw new SessionOwnershipError();
  if (facts.turnCount === 0) return false;
  const key = prefixMessageKey(request.prefix.caseId);
  if (await parts.records.carriesPrefix(request.sessionId, key)) return true;
  throw new SessionNotEmptyError();
}

/**
 * The intake's own transaction: the session row, the user message and the
 * `running` run this prefix will be written under — or `null` when the intake
 * answered a REPLAY, which is this case's prefix already committed.
 *
 * The replay branch is the idempotency guard's second half, and it is the
 * authoritative one: the read above can be overtaken between its answer and
 * this write, while `messages_session_client_message_id` cannot. Two guards
 * because they refuse different things — the read separates a re-seeding from
 * somebody else's conversation, this one makes the re-seeding itself write
 * nothing.
 */
async function openedPrefixRun(
  parts: PrefixSeedingParts, request: PrefixSeedingRequest,
): Promise<string | null> {
  const { sessionId, identityId, payer, prefix } = request;
  const at = parts.now();
  const submission = prefixSubmission(prefix, sessionId, identityId, payer);
  const reservation = quotaReservationFor(payer, identityId, at);
  const receipt = await parts.turns.openTurn({
    submission, deadlineAt: new Date(at + TURN_DEADLINE_MS), reservation,
  });
  return receipt.replayed ? null : receipt.runId;
}

/** The step and the message that issued it, under this incarnation's lease. */
async function writtenStep(
  parts: PrefixSeedingParts, prefix: TrajectoryPrefix, runId: string, at: Date,
): Promise<void> {
  const leaseUntil = new Date(parts.now() + LEASE_SLICE_MS);
  if (!await parts.store.takeLease(runId, parts.owner, leaseUntil)) {
    throw new PrefixNotWritableError("its lease is held by another writer");
  }
  const turn = await parts.store.loadRunningTurn(runId);
  if (turn === null) throw new PrefixNotWritableError("it is no longer running");
  const held = await parts.store.persistStep(turn, parts.owner, prefixStep(prefix, runId), leaseUntil, at);
  if (!held) throw new PrefixNotWritableError("its lease was lost mid-write");
}

/**
 * The run driven to `succeeded`, with the envelope banked either side of it.
 *
 * The order is the live path's own (`envelope-staging-store.ts`): the envelope
 * is staged under the run's key BEFORE the terminal row lands and promoted
 * after, because the two stores share no transaction and only this order leaves
 * a recoverable state behind. It is not an optimisation to skip here — a seeded
 * prefix whose promotion failed must be finishable exactly as a turn's is.
 */
async function settledPrefixRun(
  parts: PrefixSeedingParts, request: PrefixSeedingRequest, runId: string, at: Date,
): Promise<void> {
  const { prefix, sessionId } = request;
  await parts.envelopes.stage(runId, prefixEnvelope(prefix));
  await parts.store.settleSucceeded(prefixAnswer(prefix, runId, sessionId, parts.prices), at);
  await parts.envelopes.promote(runId);
}

/**
 * Seed one prefix, or answer that this case's prefix is already there.
 *
 * A session nobody has read yet has no facts row at all, which is the ordinary
 * first seeding: `openTurn` creates the session on the caller's identity, and
 * that is where its ownership comes from.
 */
export async function seedTrajectoryPrefix(
  parts: PrefixSeedingParts, request: PrefixSeedingRequest,
): Promise<SeededPrefixReceipt> {
  const facts = await parts.records.factsOf(request.sessionId);
  if (facts !== null && await alreadySeeded(parts, request, facts)) return ALREADY_SEEDED;
  const runId = await openedPrefixRun(parts, request);
  if (runId === null) return ALREADY_SEEDED;
  const at = new Date(parts.now());
  await writtenStep(parts, request.prefix, runId, at);
  await settledPrefixRun(parts, request, runId, at);
  return SEEDED_NOW;
}
