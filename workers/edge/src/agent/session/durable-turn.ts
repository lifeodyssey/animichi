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
 *   already_settled — the run is not `running`, so there is no turn to drive.
 *                Settles nothing either, but for the opposite reason: nobody
 *                holds it, and this alarm is the retry of the one that ended it.
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
 *
 * TWO REFUSALS THAT ARE NOT PROVIDER FAILURES BUT SETTLE AS ONE. The first is
 * a deployment that resolved no model at all; the second (#1289) is a run
 * committed against the CALLER's own key, reached by an incarnation that does
 * not have it. The credential lives in one Durable Object incarnation's heap
 * and dies with it, while the run row survives — so an eviction between the
 * arm and the alarm, or a `RunSweeper` re-arm of a stranded run, arrives here
 * with `turn.callerKeyed` true and a server-key model in hand. Driving it
 * would be exactly the server-key fallback spec §四 S5 forbids, so the turn
 * ends `provider_failed` instead: the reservation is given back by
 * `settleFailedTurn`'s own SQL, the stream closes on the error frames a
 * connected client already knows how to read, and the caller resends. The run
 * row is the ONLY durable trace that a turn was caller-keyed — the key itself
 * is never written anywhere — which is why the check is on the payer and not
 * on anything richer.
 *
 * NEITHER APPLIES TO A DETERMINISTIC SELECTION (#1288) — see `#unrunnable`.
 * Both are decided here rather than by the caller because only this class has
 * the loaded run, and only the loaded run says which kind of turn it is.
 */
import type { RunFailureReason } from "../../db/schema.ts";
import type { UsagePrices } from "../settlement/turn-settlement.ts";
import { ProviderFailure, RunMachine, TurnStoreUnavailable, type TurnState } from "./run-machine.ts";
import { TurnAttempt, type TurnAttemptParts } from "./turn-attempt.ts";
import { TurnEnding } from "./turn-ending.ts";
import { closingFrames, openingFrames } from "./turn-frames.ts";
import type { LoadedTurn } from "./turn-store.ts";

/**
 * A turn that never reached a lease because the run is not `running` any more.
 *
 * Its own phase, not `declined`: an alarm that finds the run already terminal is
 * the RETRY of the alarm that settled it, and may still owe that run the last
 * step of its ending (`TurnEnvelope` promotes what the lost attempt staged,
 * #1280). A contender that merely lost the lease owes the run nothing, because
 * a live owner is mid-turn on it — so the two must not answer the same thing.
 */
const NOT_RUNNING: TurnState = { phase: "already_settled" };

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
    const attempt = new TurnAttempt(turn, machine, this.#parts);
    const state = await this.#settled(turn, machine, attempt);
    if (state.phase === "abandoned") return state;
    await this.#parts.emit(closingFrames(state, attempt.answer));
    return state;
  }

  /**
   * The deadline is checked BEFORE the first model call as well as between
   * turns: a run whose budget is already spent must not reach a provider, and
   * `runs_lease_within_deadline_check` clamps its lease to the deadline, so
   * without this it would present as a lost lease rather than the expiry it is.
   */
  async #settled(turn: LoadedTurn, machine: RunMachine, attempt: TurnAttempt): Promise<TurnState> {
    const opened = machine.beginStep();
    if (opened.phase !== "running") return await this.#failed(turn, opened);
    const refused = this.#unrunnable(turn);
    if (refused !== null) return await this.#failed(turn, machine.fail(refused));
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
    await this.#ending.succeeded(turn, attempt.output, attempt.answer, attempt.spent);
    return machine.succeed();
  }

  /**
   * Why this incarnation cannot drive this run, or `null`. Both checks are
   * about reaching a PROVIDER, and both happen before the first model call.
   *
   * A DETERMINISTIC selection is exempt from both, and the exemption is the
   * whole reason this is one method (#1288). Such a turn answers from the
   * catalog and never contacts a provider, so a deployment holding `CATALOG`
   * but no model key can still answer a pick; and a caller-keyed selection
   * revived on a fresh incarnation is not a turn that could fall back to the
   * server's key, because there is no key in its path to fall back to.
   * Refusing either would fail a turn for a resource it does not use.
   */
  #unrunnable(turn: LoadedTurn): ProviderFailure | null {
    if (turn.selection !== null) return null;
    const { model } = this.#parts;
    if (model === null) return new ProviderFailure("this deployment resolved no model for this turn");
    if (!turn.callerKeyed || model.callerKeyed) return null;
    return new ProviderFailure("caller-keyed run lost its credential; resend the turn");
  }

  /** The failure settlement — and the refund's exactly-once contract with it. */
  async #failed(turn: LoadedTurn, state: TurnState): Promise<TurnState> {
    const reason: RunFailureReason = state.phase === "failed" ? state.reason : "internal_error";
    await this.#ending.failed(turn, reason);
    return state;
  }
}
