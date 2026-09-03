/**
 * How one turn ENDS, and what that costs (card #1252, spec §三: "结束 =
 * assistant message + usage 结算 + run=succeeded 同一 TX").
 *
 * A turn's ending is not the same concern as driving it: it is a pair of
 * transactions with their own rules — a success banks the answer and the tokens
 * together, a failure hands back the quota reservation exactly once — and
 * `DurableTurn` is the thing that decides WHICH of them happens, not how either
 * one is written. Keeping them apart is what lets the loop read as the loop.
 */
import type { RunFailureReason } from "../../db/schema.ts";
import type { UsagePrices } from "../settlement/turn-settlement.ts";
import type { TurnOutput } from "./turn-output.ts";
import type { LoadedTurn, TurnStore } from "./turn-store.ts";

export interface TurnEndingParts {
  readonly store: TurnStore;
  readonly prices: UsagePrices;
  readonly now: () => number;
}

export class TurnEnding {
  readonly #parts: TurnEndingParts;

  constructor(parts: TurnEndingParts) {
    this.#parts = parts;
  }

  /** The answer, its tokens and the terminal row, on one transaction. */
  async succeeded(turn: LoadedTurn, output: TurnOutput): Promise<void> {
    const record = {
      runId: turn.runId,
      sessionId: turn.sessionId,
      answer: output.answer,
      responseData: null,
      usage: output.usage,
      prices: this.#parts.prices,
    };
    await this.#parts.store.settleSucceeded(record, this.#at());
  }

  /** The terminal row with its reason — and the refund's exactly-once SQL. */
  async failed(turn: LoadedTurn, reason: RunFailureReason): Promise<void> {
    await this.#parts.store.settleFailed(turn.runId, reason, this.#at());
  }

  #at(): Date {
    return new Date(this.#parts.now());
  }
}
