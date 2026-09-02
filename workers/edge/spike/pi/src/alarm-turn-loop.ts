// W0-S4 spike (#1247): the alarm side of the Durable Object.
//
// One alarm invocation drains the turns the intake queued in Durable Object
// storage — storage, not a closure, which is exactly what lets a retry after an
// uncaught exception (or a fresh incarnation after an eviction) pick the same
// run back up with the same ids and replay its settled steps.
//
// An `InjectedCrash` escapes on purpose. Cloudflare's `alarm()` contract is
// at-least-once with exponential-backoff retry on an uncaught exception, and
// that retry is the recovery path the card's crash branch is there to exercise.

import { DurableTurn } from "./durable-turn.ts";
import { HeldSpotLookup, type Sleep } from "./held-spot-lookup.ts";
import type { PendingTurn, RunJournal } from "./run-journal.ts";
import type { RunStore } from "./run-store.ts";
import type { TurnSubscribers } from "./turn-subscribers.ts";

export interface AlarmTurnLoopParts {
  store: RunStore | null;
  journal: RunJournal;
  subscribers: TurnSubscribers;
  /** The Durable Object incarnation taking the run's single-writer lease. */
  owner: string;
  now: () => number;
  sleep: Sleep;
}

export class AlarmTurnLoop {
  private readonly parts: AlarmTurnLoopParts;

  constructor(parts: AlarmTurnLoopParts) {
    this.parts = parts;
  }

  async runPending(): Promise<void> {
    const { store, journal } = this.parts;
    if (store === null) return;
    for (const pending of await journal.pendingTurns()) await this.drive(store, pending);
  }

  private async drive(store: RunStore, pending: PendingTurn): Promise<void> {
    const { runId } = pending.identity;
    await new DurableTurn({
      store,
      journal: this.parts.journal,
      toolbox: this.toolboxFor(pending),
      emit: this.parts.subscribers.sinkFor(runId),
      owner: this.parts.owner,
      now: this.parts.now,
    }).run(pending);
    await this.parts.journal.dequeue(runId);
    await this.parts.subscribers.close(runId);
  }

  private toolboxFor(pending: PendingTurn): HeldSpotLookup {
    const { holdMs, failAtStep } = pending.command;
    return new HeldSpotLookup(holdMs, failAtStep, this.parts.sleep, this.parts.journal);
  }
}
