/**
 * The turn store, with the session's envelope banked immediately before the
 * run's terminal row (card #1280, PR #1282 review).
 *
 * WHY THE ORDER IS THE FIX: the two writes land in different stores — the
 * terminal row in Neon, the envelope in Durable Object storage — so no
 * transaction can span them. What can be arranged is which goes first, and each
 * order fails differently:
 *   - stage, then settle. A failed staging leaves the run `running`, so the
 *     alarm's retry replays the whole turn and nothing is lost. A failed
 *     PROMOTION leaves the run terminal with the answer already on disk, and the
 *     retry finds `loadRunningTurn` null, declines, and promotes what is waiting.
 *   - settle, then stage. There is a window in which the run is terminal and the
 *     envelope was never written down anywhere. The retry declines with nothing
 *     staged, and the turn's clarification and resolved anime are simply gone.
 * Only the first order is recoverable, which is why this exists at all.
 *
 * WHY A DECORATOR: `DurableTurn` settles runs. What else has to be durable when
 * a run settles is not its business, and threading a hook through
 * `DurableTurnParts` would put session state into the vocabulary of every turn
 * the loop drives. Wrapping the port instead keeps the ordering guarantee at the
 * seam that owns it — `session-turn.ts`, where the envelope enters the turn.
 */
import type { RunFailureReason } from "../../db/schema.ts";
import type { SettlementResult } from "../settlement/turn-settlement.ts";
import type { TurnEnvelope } from "./turn-envelope.ts";
import type {
  LoadedTurn,
  SettledStep,
  SucceededTurnRecord,
  TurnStore,
} from "./turn-store.ts";

export class EnvelopeStagingStore implements TurnStore {
  readonly #store: TurnStore;
  readonly #envelope: TurnEnvelope;

  constructor(store: TurnStore, envelope: TurnEnvelope) {
    this.#store = store;
    this.#envelope = envelope;
  }

  takeLease(runId: string, owner: string, until: Date): Promise<boolean> {
    return this.#store.takeLease(runId, owner, until);
  }

  loadRunningTurn(runId: string): Promise<LoadedTurn | null> {
    return this.#store.loadRunningTurn(runId);
  }

  persistStep(
    turn: LoadedTurn,
    owner: string,
    step: SettledStep,
    leaseUntil: Date,
    at: Date,
  ): Promise<boolean> {
    return this.#store.persistStep(turn, owner, step, leaseUntil, at);
  }

  async settleSucceeded(record: SucceededTurnRecord, at: Date): Promise<SettlementResult> {
    await this.#envelope.stage();
    return await this.#store.settleSucceeded(record, at);
  }

  async settleFailed(runId: string, reason: RunFailureReason, at: Date): Promise<SettlementResult> {
    await this.#envelope.stage();
    return await this.#store.settleFailed(runId, reason, at);
  }
}
