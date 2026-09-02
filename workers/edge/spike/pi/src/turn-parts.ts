// W0-S4 spike (#1247): what a turn is driven with.
//
// One record shared by `DurableTurn` and `TurnStep` — the store it writes to,
// the journal it remembers with, the tool it calls, where its frames go, who
// holds the lease, and the clock. Named here rather than in either of them so
// the two do not import each other just to agree on a parameter list.

import type { TurnToolbox } from "./held-spot-lookup.ts";
import type { TurnJournal } from "./run-journal.ts";
import type { RunStore } from "./run-store.ts";

export type TurnEventSink = (
  event: string,
  data: Record<string, string | number | boolean>,
) => Promise<void>;

export interface DurableTurnParts {
  store: RunStore;
  journal: TurnJournal;
  toolbox: TurnToolbox;
  emit: TurnEventSink;
  /** The Durable Object incarnation that holds the run's single-writer lease. */
  owner: string;
  now: () => number;
}
