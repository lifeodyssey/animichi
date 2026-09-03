/**
 * The run ids one session's alarm still owes work to (card #1252).
 *
 * They live in Durable Object STORAGE rather than in a field, and that is the
 * whole reason this exists: `fetch` and `alarm()` are two separate calls, an
 * incarnation can be evicted between them, and an uncaught exception inside
 * `alarm()` earns a platform retry on a fresh incarnation. A queue held in the
 * heap would lose the run in exactly the cases the retry exists for. Storage
 * survives all three, so a retried alarm picks the same run back up and replays
 * its settled steps.
 *
 * Every write is awaited. Cloudflare's write coalescing only batches writes
 * with no `await` between them ("Rules of Durable Objects", Write coalescing),
 * so an awaited `put` is committed on its own and therefore survives the
 * uncaught exception that triggers the retry.
 */

/**
 * The slice of `DurableObjectStorage` this queue uses. Narrow on purpose:
 * `DurableObjectState.storage` satisfies it structurally, so a test hands in a
 * real Map-backed implementation rather than a stand-in that only pretends to
 * be storage.
 */
export interface QueueStorage {
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<boolean>;
  list(options: { prefix: string }): Promise<Map<string, unknown>>;
}

const PENDING = "pending:";

export class SessionRunQueue {
  readonly #storage: QueueStorage;

  constructor(storage: QueueStorage) {
    this.#storage = storage;
  }

  async queue(runId: string): Promise<void> {
    await this.#storage.put(PENDING + runId, runId);
  }

  /** Only `queue()` writes under this prefix, so a value that is not a run id
   * is dropped rather than handed to the loop as one. */
  async pending(): Promise<string[]> {
    const held = await this.#storage.list({ prefix: PENDING });
    return [...held.values()].filter((value) => typeof value === "string");
  }

  async dequeue(runId: string): Promise<void> {
    await this.#storage.delete(PENDING + runId);
  }
}
