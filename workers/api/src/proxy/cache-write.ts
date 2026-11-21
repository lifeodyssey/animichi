/**
 * A cache write, and the fact that it failed (EG-16, issue #1343).
 *
 * The two edge proxies wrote to the cache in the two ways the catalog worker
 * was already caught with (08-26 §2.4): one bare `waitUntil(put)` whose
 * rejection went unhandled, and one `.catch(() => undefined)` that swallowed
 * it. Neither said anything — and a cache tier that is silently failing looks
 * exactly like a slow origin.
 *
 * The write itself stays off the response path (that is what `waitUntil` is
 * for) and a failed write is never fatal: the caller has already answered. Only
 * the failure becomes a record — the caller's own event name and the error's
 * NAME, never a cache key, because cache keys are URLs and URLs carry
 * identifiers.
 */

/** The `waitUntil` half of an execution context — all a cache write needs. */
export interface CacheWriteContext {
  waitUntil(promise: Promise<unknown>): void;
}

export function cacheWrite(ctx: CacheWriteContext, write: Promise<unknown>, event: string): void {
  ctx.waitUntil(write.catch((error: unknown) => { logCacheWriteFailure(event, error); }));
}

function logCacheWriteFailure(event: string, error: unknown): void {
  console.warn(JSON.stringify({ event, error: error instanceof Error ? error.name : "unknown" }));
}
