// The Durable Object state the W0-S4 tests (#1247) hand `makeTurnHost`.
//
// Not a stand-in for `DurableObjectState`: `TurnHostState` and `JournalStorage`
// are the narrow ports the host actually uses, and this is a real, complete
// implementation of them over a Map. The deployed Worker passes the runtime's
// own state, which satisfies the same ports structurally.

import type { TurnHostState } from "../../spike/pi/src/turn-host.ts";
import type { JournalStorage } from "../../spike/pi/src/run-journal.ts";

export class MemoryJournalStorage implements JournalStorage {
  private readonly entries = new Map<string, unknown>();
  alarmAt: number | null = null;

  get(key: string): Promise<unknown> {
    return Promise.resolve(this.entries.get(key));
  }

  put(key: string, value: unknown): Promise<void> {
    this.entries.set(key, value);
    return Promise.resolve();
  }

  delete(key: string): Promise<boolean> {
    return Promise.resolve(this.entries.delete(key));
  }

  list(options: { prefix: string }): Promise<Map<string, unknown>> {
    return Promise.resolve(new Map([...this.entries].filter(([key]) => key.startsWith(options.prefix))));
  }

  setAlarm(when: number): Promise<void> {
    this.alarmAt = when;
    return Promise.resolve();
  }
}

export class MemoryTurnHostState implements TurnHostState {
  readonly id = { toString: () => "memory-turn-host" };
  readonly storage = new MemoryJournalStorage();
}
