/**
 * The intake use case (spec `docs/specs/2026-09-01-agent-ts-rewrite-spec.md`
 * §三, issue #1251): one `POST /v1/chat` becomes one durable turn.
 *
 * Everything durable happens in a single transaction the `TurnRecords` port
 * owns — the user message (deduped on `(session_id, client_message_id)`), the
 * `running` run, and the quota reservation. Only after that COMMIT does this
 * module wake the session's Durable Object, which is what makes the pair an
 * outbox rather than a two-phase write: a crash before the wake-up leaves a
 * committed run with no lease, exactly the row the singleton RunSweeper scans
 * for.
 */
import type { RunPayer } from "../../db/schema.ts";
import type { SessionWakeup } from "../session/session-wakeup.ts";
import { quotaReservationFor, type QuotaReservation } from "./quota-reservation.ts";

/**
 * The production whole-turn budget (spec §二/§四): `runs.deadline_at` is
 * `now + 100s`, non-renewable, and `runs_lease_within_deadline_check` caps
 * every lease renewal at it. The alarm handler's own wall-clock ceiling is 15
 * minutes, so this is a product decision with 9x headroom, not a platform one.
 */
export const TURN_DEADLINE_MS = 100_000;

/** The trusted facts one submission carries into the intake. Identity comes
 * from the edge identity layer already verified (AUTH-2 #950) — the intake
 * never re-verifies it and never reads a header itself. */
export interface TurnSubmission {
  readonly sessionId: string;
  readonly identityId: string;
  readonly payer: RunPayer;
  readonly clientMessageId: string;
  readonly text: string;
}

/** What the intake resolved a submission to. `replayed` marks the dedupe hit:
 * the ids are the ones the first submission committed, and nothing was
 * written this time. */
export interface IntakeReceipt {
  readonly messageId: string;
  readonly runId: string;
  readonly replayed: boolean;
}

/** One turn's worth of durable intent, handed to the transaction whole. */
export interface OpenedTurn {
  readonly submission: TurnSubmission;
  readonly deadlineAt: Date;
  readonly reservation: QuotaReservation | null;
}

/** The one durable write seam of the intake: message + run + reservation, or
 * nothing at all. */
export interface TurnRecords {
  openTurn(turn: OpenedTurn): Promise<IntakeReceipt>;
}

/** Why the intake could not open a turn on a session that is already live. */
export type SessionBusyReason = "running_turn" | "orphaned_replay";

/**
 * A session runs at most one turn at a time — `runs_one_running_per_session`
 * makes that a unique-key loss on INSERT rather than a read-then-write race
 * (`running_turn`).
 *
 * `orphaned_replay` is the other refusal: the dedupe key already names a
 * message that no run points at. This intake never commits one without the
 * other, so the state is not one it can produce — it is a message some other
 * writer left, or one whose run was removed. Refusing is the only safe answer
 * (`runs_message_id_key` would reject a second run for that message anyway).
 * Note that a replay racing its own original is NOT this case: the duplicate
 * INSERT blocks until the first transaction ends, and a READ COMMITTED
 * statement then sees the committed row.
 */
export class SessionBusyError extends Error {
  readonly reason: SessionBusyReason;

  constructor(reason: SessionBusyReason) {
    super(`session busy: ${reason}`);
    this.name = "SessionBusyError";
    this.reason = reason;
  }
}

/** The turn one submission opens: its budget and what it reserves. */
function turnFor(submission: TurnSubmission, at: number): OpenedTurn {
  return {
    submission,
    deadlineAt: new Date(at + TURN_DEADLINE_MS),
    reservation: quotaReservationFor(submission.payer, submission.identityId, at),
  };
}

/** Commit one turn, then wake its session. A replay wakes nothing: it opened
 * no run, and the run it resolved to is already running or already settled. */
export async function acceptTurn(
  records: TurnRecords,
  wakeup: SessionWakeup,
  submission: TurnSubmission,
  now: () => number = Date.now,
): Promise<IntakeReceipt> {
  const receipt = await records.openTurn(turnFor(submission, now()));
  if (!receipt.replayed) await wakeup.arm(submission.sessionId, receipt.runId);
  return receipt;
}
