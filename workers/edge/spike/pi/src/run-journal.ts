// W0-S4 spike (#1247): what the Durable Object durably remembers about a run,
// beside Neon.
//
// Three things belong here rather than in Neon. The queued command, because the
// hold and the fault-injection switches are spike inputs, not turn state — an
// alarm that fires after an eviction has to find them somewhere. The tool-call
// counter, because "how many times did the tool actually execute" is the whole
// evidence for the idempotency claim and must survive the injected crash. And
// the billed wall-clock, because it measures THIS Durable Object, not the run.
//
// Every write is awaited. Cloudflare's write coalescing only batches writes with
// no `await` between them ("Rules of Durable Objects", Write coalescing); an
// awaited `put` is committed on its own and therefore survives the uncaught
// exception the crash branch throws.

import type { LongTurnCommand } from "./long-turn-command.ts";
import type { TurnIdentity } from "./run-store.ts";

/**
 * The slice of `DurableObjectStorage` this journal uses. Narrow on purpose:
 * `DurableObjectState.storage` satisfies it structurally, and a test can hand in
 * a real Map-backed implementation instead of a stand-in that only pretends to
 * be storage.
 */
export interface JournalStorage {
  get(key: string): Promise<unknown>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<boolean>;
  list(options: { prefix: string }): Promise<Map<string, unknown>>;
}

/** The tool records each real execution here — the mutation-proof instrument. */
export interface ToolCallLedger {
  recordCall(runId: string): Promise<void>;
}

/** What the state machine needs from the journal: fault injection and billing. */
export interface TurnJournal {
  consumeCrash(runId: string): Promise<boolean>;
  addBilledMs(runId: string, ms: number): Promise<void>;
}

export interface PendingTurn {
  identity: TurnIdentity;
  command: LongTurnCommand;
}

const PENDING = "pending:";

/**
 * Only `queue()` ever writes under this prefix, so this is a corruption guard
 * rather than a parser: a value that is not shaped like a queued turn is dropped
 * instead of being handed to the loop as one.
 */
function queuedTurnOf(value: unknown): PendingTurn[] {
  if (typeof value !== "object" || value === null) return [];
  const held = value as Partial<PendingTurn>;
  const named = typeof held.identity?.runId === "string";
  return named && typeof held.command?.toolCalls === "number" ? [held as PendingTurn] : [];
}

export class RunJournal implements ToolCallLedger, TurnJournal {
  private readonly storage: JournalStorage;

  constructor(storage: JournalStorage) {
    this.storage = storage;
  }

  async queue(pending: PendingTurn): Promise<void> {
    await this.storage.put(PENDING + pending.identity.runId, pending);
  }

  async pendingTurns(): Promise<PendingTurn[]> {
    const held = await this.storage.list({ prefix: PENDING });
    return [...held.values()].flatMap(queuedTurnOf);
  }

  async dequeue(runId: string): Promise<void> {
    await this.storage.delete(PENDING + runId);
  }

  async recordCall(runId: string): Promise<void> {
    await this.storage.put(`calls:${runId}`, (await this.toolCalls(runId)) + 1);
  }

  async toolCalls(runId: string): Promise<number> {
    return await this.counter(`calls:${runId}`);
  }

  /** True once per run: the injected crash must not repeat on the retry. */
  async consumeCrash(runId: string): Promise<boolean> {
    if ((await this.storage.get(`crashed:${runId}`)) === true) return false;
    await this.storage.put(`crashed:${runId}`, true);
    return true;
  }

  async addBilledMs(runId: string, ms: number): Promise<void> {
    await this.storage.put(`billed:${runId}`, (await this.billedMs(runId)) + ms);
  }

  async billedMs(runId: string): Promise<number> {
    return await this.counter(`billed:${runId}`);
  }

  /** Storage hands back `unknown`; a counter that is not a number reads as zero. */
  private async counter(key: string): Promise<number> {
    const held = await this.storage.get(key);
    return typeof held === "number" ? held : 0;
  }
}
