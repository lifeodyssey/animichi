/**
 * The Durable Object storage a session's envelope lives in, as a test can read
 * it back (card #1280).
 *
 * Map-backed and REAL rather than a stand-in that pretends: it structured-clones
 * on the way in, the way `DurableObjectStorage` does, so a test that mutates the
 * value it handed over cannot make a stale read look fresh. It also counts the
 * writes, because "written back exactly once per turn" is one of the properties
 * under test and a store that could not count them would let a double write
 * through.
 */
import type { EnvelopeStorage } from "../../src/agent/session/durable-envelope-store.ts";

export class RecordingEnvelopeStorage implements EnvelopeStorage {
  /** Every value this storage was asked to write, oldest first. */
  readonly writes: unknown[] = [];
  readonly #values = new Map<string, unknown>();

  put(key: string, value: unknown): Promise<void> {
    const held = structuredClone(value);
    this.#values.set(key, held);
    this.writes.push(held);
    return Promise.resolve();
  }

  get(key: string): Promise<unknown> {
    return Promise.resolve(this.#values.get(key));
  }

  /** Seed the storage with a value an earlier deployment could have written. */
  seed(key: string, value: unknown): void {
    this.#values.set(key, value);
  }
}
