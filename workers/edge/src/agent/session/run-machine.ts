/**
 * One alarm-hosted turn as a state machine (card #1252, spec
 * `docs/specs/2026-09-01-agent-ts-rewrite-spec.md` §三), ported from the W0-S4
 * spike's `durable-turn.ts` / `turn-step.ts` split.
 *
 * Pure and clock-injected: it knows nothing about Durable Objects, pi or Neon,
 * so every transition is drivable in a unit test with a fake clock. The host
 * (`DurableTurn`) answers the questions — did the lease compare-and-set land,
 * did the renewal hold — and this decides what the turn becomes.
 *
 * The six phases are not interchangeable, and the two that are not endings are
 * the interesting ones:
 * - `declined` — the compare-and-set lost to a live foreign owner. That owner
 *   is running this turn, so THIS incarnation settles nothing at all: a sweep
 *   that re-armed a run someone else already holds must be a no-op (§三
 *   "扫描幂等（重复叫醒无副作用，由 DO 侧租约保证）").
 * - `abandoned` — the lease was lost MID-turn: it expired and another
 *   incarnation took it over. Settling `lease_expired` here would race the new
 *   owner's own settlement, so this one stops and writes nothing; whoever holds
 *   the lease now owns the ending.
 *
 * `tool_failed` is deliberately not produced here. pi catches a tool's throw
 * and hands the model an error tool result (`agent-loop`'s `executeToolCall`),
 * which is the same recovery the Python `error_boundary.on_tool_execute_error`
 * hook performed — so a failing tool is a turn the model continues, not a turn
 * that ends. The vocabulary itself belongs to `runs_failure_reason_check`.
 */
import type { RunFailureReason } from "../../db/schema.ts";

/** The lease slice one incarnation asks for; `runs_lease_within_deadline_check`
 * clamps it at the run's own deadline, so this is a request, not a promise. */
export const LEASE_SLICE_MS = 30_000;

/** Where one turn is. `running` is the only phase work happens in. */
export type TurnPhase =
  | "unclaimed"
  | "running"
  | "declined"
  | "abandoned"
  | "succeeded"
  | "failed";

/** A phase, with the reason the database requires when it is `failed`. */
export type TurnState =
  | { readonly phase: Exclude<TurnPhase, "failed"> }
  | { readonly phase: "failed"; readonly reason: RunFailureReason };

const RUNNING: TurnState = { phase: "running" };

/** The provider (or the kernel driving it) failed this turn. */
export class ProviderFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderFailure";
  }
}

/**
 * The durable store itself failed.
 *
 * It is not a turn failure, and that distinction is load-bearing: settling a
 * turn IS a write, so a store that just refused one cannot be trusted to record
 * a terminal row either. A turn that ends this way is left `running` on
 * purpose — the alarm's own at-least-once retry, and behind it the singleton
 * `RunSweeper`, are what pick it back up, and the steps that DID land are
 * replayed rather than re-executed (spec Appendix C).
 */
export class TurnStoreUnavailable extends Error {
  constructor(cause: unknown) {
    super("the turn store refused a write", { cause });
    this.name = "TurnStoreUnavailable";
  }
}

/** The turn was aborted rather than failing on its own. */
export class TurnAborted extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TurnAborted";
  }
}

/** Map a thrown value onto the bounded reason the client reads back. */
export function failureReasonOf(error: unknown): RunFailureReason {
  if (error instanceof TurnAborted) return "cancelled";
  if (error instanceof ProviderFailure) return "provider_failed";
  return "internal_error";
}

export class RunMachine {
  readonly #deadlineAt: number;
  readonly #now: () => number;
  #state: TurnState = { phase: "unclaimed" };

  constructor(deadlineAt: number, now: () => number) {
    this.#deadlineAt = deadlineAt;
    this.#now = now;
  }

  get state(): TurnState {
    return this.#state;
  }

  /** The slice this incarnation asks the lease for, never past the deadline. */
  leaseUntil(): Date {
    return new Date(Math.min(this.#now() + LEASE_SLICE_MS, this.#deadlineAt));
  }

  /** The opening compare-and-set: won it, or another live owner has the turn. */
  claim(taken: boolean): TurnState {
    return this.#move(taken ? RUNNING : { phase: "declined" });
  }

  /** Checked before every step: the whole-turn budget is not renewable. */
  beginStep(): TurnState {
    const live = this.#now() < this.#deadlineAt;
    return this.#move(live ? RUNNING : { phase: "failed", reason: "deadline_exceeded" });
  }

  /** A mid-turn renewal that did not land means someone else took over. */
  renewed(held: boolean): TurnState {
    return this.#move(held ? RUNNING : { phase: "abandoned" });
  }

  succeed(): TurnState {
    return this.#move({ phase: "succeeded" });
  }

  fail(error: unknown): TurnState {
    return this.#move({ phase: "failed", reason: failureReasonOf(error) });
  }

  #move(next: TurnState): TurnState {
    this.#state = next;
    return next;
  }
}
