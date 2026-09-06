/**
 * The Durable Object storage this lane stands in for.
 *
 * The database arm proves the SQL half of a seeded prefix; the envelope half
 * lives in `ctx.storage`, which no PostgreSQL container has. A Map is the whole
 * of what `DurableEnvelopeStore` needs (`EnvelopeStorage` is three methods),
 * and the envelope's own properties are measured under `test/` where a real
 * clone-on-write storage double already exists.
 */
import type { EnvelopeStorage } from "../src/agent/session/durable-envelope-store.ts";

export class InMemoryEnvelopeStorage implements EnvelopeStorage {
  readonly #values = new Map<string, unknown>();

  put(key: string, value: unknown): Promise<void> {
    this.#values.set(key, structuredClone(value));
    return Promise.resolve();
  }

  get(key: string): Promise<unknown> {
    return Promise.resolve(this.#values.get(key));
  }

  delete(key: string): Promise<boolean> {
    return Promise.resolve(this.#values.delete(key));
  }
}
