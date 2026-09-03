/**
 * The Durable Object storage a session's envelope lives in, as a test can read
 * it back (card #1280).
 *
 * Map-backed and REAL rather than a stand-in that pretends: it structured-clones
 * on the way in, the way `DurableObjectStorage` does, so a test that mutates the
 * value it handed over cannot make a stale read look fresh. It records writes
 * per KEY, because the properties under test are per key — the session's
 * envelope is written once a turn, while a run's staging comes and goes.
 *
 * `failNextWriteTo` is the crash the staging/promotion split exists for: a
 * terminal row that landed in Neon and an envelope write that then refused.
 */
import { SESSION_ENVELOPE_KEY } from "../../src/agent/session/durable-envelope-store.ts";
import type { EnvelopeStorage } from "../../src/agent/session/durable-envelope-store.ts";

/** One write, as this storage saw it. */
export interface RecordedWrite {
  readonly key: string;
  readonly value: unknown;
}

export class RecordingEnvelopeStorage implements EnvelopeStorage {
  /** Every write this storage accepted, oldest first. */
  readonly writes: RecordedWrite[] = [];
  /** The one key whose next write refuses, then clears itself. */
  failNextWriteTo: string | null = null;
  readonly #values = new Map<string, unknown>();

  put(key: string, value: unknown): Promise<void> {
    if (key === this.failNextWriteTo) {
      this.failNextWriteTo = null;
      return Promise.reject(new Error(`storage refused a write to ${key}`));
    }
    const held = structuredClone(value);
    this.#values.set(key, held);
    this.writes.push({ key, value: held });
    return Promise.resolve();
  }

  get(key: string): Promise<unknown> {
    return Promise.resolve(this.#values.get(key));
  }

  delete(key: string): Promise<boolean> {
    return Promise.resolve(this.#values.delete(key));
  }

  /** Every write that landed on the session's own envelope key. */
  get envelopeWrites(): unknown[] {
    return this.writes.filter((write) => write.key === SESSION_ENVELOPE_KEY).map((write) => write.value);
  }

  /** The keys this storage still holds — a leftover staging shows up here. */
  get keys(): string[] {
    return [...this.#values.keys()];
  }

  /** Seed the storage with a value an earlier deployment could have written. */
  seed(key: string, value: unknown): void {
    this.#values.set(key, value);
  }
}
