/**
 * The alarm-hosted turn (card #1252, spec
 * `docs/specs/2026-09-01-agent-ts-rewrite-spec.md` §三), ported from the W0-S4
 * spike's `durable-turn.ts`.
 *
 * The loop §三 describes with nothing else in it: take the run's single-writer
 * lease, rebuild the transcript, drive the pi Agent over the toolbox, and settle.
 * It knows nothing about Durable Objects, SSE transports or Neon drivers — the
 * host supplies those through ports — so the whole recovery matrix is drivable
 * in a unit test with an injected clock and a truthful provider double.
 *
 * Five endings, and they differ on purpose:
 *   succeeded  — assistant message + usage rollup + `run=succeeded`, one TX.
 *   failed     — settled with a reason from `runs_failure_reason_check`, and the
 *                quota reservation refunded exactly once by that same SQL.
 *   declined   — the opening compare-and-set lost to a live owner. Settles
 *                nothing: a re-armed run someone else holds is a no-op (§三).
 *   abandoned  — the lease was lost mid-turn. Settles nothing either; whoever
 *                took it over owns the ending, and writing one here would race
 *                theirs.
 *   (thrown)   — `TurnStoreUnavailable` escapes deliberately UNSETTLED, leaving
 *                the run `running` for the alarm's at-least-once retry. That is
 *                the "tool succeeded but its result was never persisted" branch
 *                the spec's Appendix C requires, and the replay is what makes
 *                the retry execute that step exactly once more.
 *   (no run)   — `loadRunningTurn` found nothing `running`. The turn is already
 *                terminal, so an at-least-once alarm has nothing left to do.
 */
import type { RunFailureReason } from "../../db/schema.ts";
import type { UsagePrices } from "../settlement/turn-settlement.ts";
import { RunMachine, TurnStoreUnavailable, type TurnState } from "./run-machine.ts";
import { TurnAttempt, type TurnAttemptParts } from "./turn-attempt.ts";
import { TurnEnding } from "./turn-ending.ts";
import { closingFrames, openingFrames } from "./turn-frames.ts";
import type { LoadedTurn } from "./turn-store.ts";

/** A turn that never reached a lease: the run is not `running` any more. */
const NOT_RUNNING: TurnState = { phase: "declined" };

export interface DurableTurnParts extends TurnAttemptParts {
  readonly prices: UsagePrices;
}

export class DurableTurn {
  readonly #parts: DurableTurnParts;
  readonly #ending: TurnEnding;

  constructor(parts: DurableTurnParts) {
    this.#parts = parts;
    this.#ending = new TurnEnding(parts);
  }

  /** Drive one run to an ending, or decline it to whoever holds its lease. */
  async run(runId: string): Promise<TurnState> {
    const turn = await this.#parts.store.loadRunningTurn(runId);
    if (turn === null) return NOT_RUNNING;
    const machine = new RunMachine(turn.deadlineAt, this.#parts.now);
    const taken = await this.#parts.store.takeLease(runId, this.#parts.owner, machine.leaseUntil());
    if (machine.claim(taken).phase !== "running") return machine.state;
    return await this.#hosted(turn, machine);
  }

  /** Everything between winning the lease and the frames that close the stream. */
  async #hosted(turn: LoadedTurn, machine: RunMachine): Promise<TurnState> {
    await this.#parts.emit(openingFrames());
    const state = await this.#settled(turn, machine);
    if (state.phase === "abandoned") return state;
    await this.#parts.emit(closingFrames(state));
    return state;
  }

  /**
   * The deadline is checked BEFORE the first model call as well as between
   * turns: a run whose budget is already spent must not reach a provider, and
   * `runs_lease_within_deadline_check` clamps its lease to the deadline, so
   * without this it would present as a lost lease rather than the expiry it is.
   */
  async #settled(turn: LoadedTurn, machine: RunMachine): Promise<TurnState> {
    const opened = machine.beginStep();
    if (opened.phase !== "running") return await this.#failed(turn, opened);
    const attempt = new TurnAttempt(turn, machine, this.#parts);
    try {
      await attempt.drive();
    } catch (error) {
      if (error instanceof TurnStoreUnavailable) throw error;
      return await this.#failed(turn, machine.fail(error));
    }
    return await this.#ended(turn, machine, attempt);
  }

  /** What the attempt left behind decides the ending, in that order. */
  async #ended(turn: LoadedTurn, machine: RunMachine, attempt: TurnAttempt): Promise<TurnState> {
    if (machine.state.phase === "failed") return await this.#failed(turn, machine.state);
    if (attempt.steps.abandoned) return machine.renewed(false);
    await this.#ending.succeeded(turn, attempt.output);
    return machine.succeed();
  }

  /** The failure settlement — and the refund's exactly-once contract with it. */
  async #failed(turn: LoadedTurn, state: TurnState): Promise<TurnState> {
    const reason: RunFailureReason = state.phase === "failed" ? state.reason : "internal_error";
    await this.#ending.failed(turn, reason);
    return state;
  }
}
