// W0-S4 spike (#1247): one Durable Object incarnation's three surfaces.
//
// Spec §三 names three components, and they are three objects here rather than
// one: the **intake** (`fetch` writes the turn down and arms the alarm), the
// **loop** (`alarm` drives it), and the **retrieval surface** (`GET /runs/:id`
// answers from Neon). They share one incarnation's subscriber map and one
// journal over its storage, which is the whole of the alarm → SSE handoff.
//
// Assembled by a function, not by a class that would only forward calls: the
// Durable Object class and the tests both want the same three objects.

import { AlarmTurnLoop } from "./alarm-turn-loop.ts";
import type { Sleep } from "./held-spot-lookup.ts";
import { RunJournal, type JournalStorage } from "./run-journal.ts";
import { RunStatusView } from "./run-status-view.ts";
import type { RunStore } from "./run-store.ts";
import { TurnIntake, type AlarmArm } from "./turn-intake.ts";
import { TurnSubscribers } from "./turn-subscribers.ts";

/**
 * The slice of `DurableObjectState` a turn host uses. `DurableObjectState`
 * satisfies it structurally, so the deployed Worker passes its own state and a
 * unit test passes a Map-backed one — no cast, no pretend runtime.
 */
export interface TurnHostState {
  readonly id: { toString(): string };
  readonly storage: JournalStorage & AlarmArm;
}

export interface TurnHost {
  intake: TurnIntake;
  loop: AlarmTurnLoop;
  status: RunStatusView;
}

export function makeTurnHost(
  ctx: TurnHostState,
  store: RunStore | null,
  now: () => number,
  sleep: Sleep,
): TurnHost {
  const journal = new RunJournal(ctx.storage);
  const subscribers = new TurnSubscribers();
  return {
    intake: new TurnIntake({ store, journal, subscribers, storage: ctx.storage, now }),
    loop: new AlarmTurnLoop({ store, journal, subscribers, owner: ctx.id.toString(), now, sleep }),
    status: new RunStatusView(store, ctx.storage),
  };
}
