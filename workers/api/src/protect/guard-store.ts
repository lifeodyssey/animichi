/// <reference types="@cloudflare/workers-types" />

/**
 * The minimal storage surface the edge guards need: a strongly-consistent
 * read-modify-write keyed map. Declared as an interface so the rate limiter
 * and the cost breaker stay pure and unit-testable against an in-memory
 * double with an injected clock, while production binds it to a Durable
 * Object (see `EdgeGuard`).
 */
export interface GuardStore {
  get(key: string): Promise<unknown>;
  put(key: string, value: unknown): Promise<void>;
}

/** A Durable Object namespace narrowed to what the guards call. */
export interface GuardNamespace {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): { fetch: (request: Request) => Promise<Response> };
}

/** Adapt a Durable Object's transactional storage to `GuardStore`. */
export function durableGuardStore(storage: DurableObjectStorage): GuardStore {
  return {
    get: (key) => storage.get(key),
    put: (key, value) => storage.put(key, value),
  };
}

/** An in-memory `GuardStore`; the DO shard is the production implementation. */
export function memoryGuardStore(): GuardStore {
  const map = new Map<string, unknown>();
  return {
    get: (key) => Promise.resolve(map.get(key)),
    put: (key, value) => {
      map.set(key, value);
      return Promise.resolve();
    },
  };
}
