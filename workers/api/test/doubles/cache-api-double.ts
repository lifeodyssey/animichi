/**
 * The edge Cache API as a case's double — `caches.default` is a workerd global
 * and is absent under `node --test`, so every case that reads it installs one
 * of these for the duration of a run.
 *
 * The install/restore pair lives here rather than in each case because three
 * test files were doing it inline, each with its own copy of the "was there a
 * global before?" branch (#1650 review S6/S7/S16). A case now writes only the
 * double it needs; the state boundary is this file's, once.
 */
/** `caches.default`, narrowed to the two calls the asset arms make of it. */
export interface CacheApiDouble {
  match(key: Request): Promise<Response | undefined>;
  put(key: Request, response: Response): Promise<void>;
}

/** `node --test` runs each file without the Cache API. Restoring this
 * descriptor leaves a global that reads as `undefined`, exactly like the one it
 * replaces, without a branch here or in the case. */
const CACHE_API_ABSENT: PropertyDescriptor = { configurable: true, value: undefined };

/** The cache write half the arms schedule on `ctx.waitUntil`, as a case owns
 * it when the write itself is the thing under test. */
export type CachePut = (key: Request, response: Response) => Promise<void>;

/** The `caches` slot the process is running with: what a case's double is
 * installed over, and what a restore has to put back. */
const cacheSlot = (): PropertyDescriptor =>
  Object.getOwnPropertyDescriptor(globalThis, "caches") ?? CACHE_API_ABSENT;

/** Runs `run` with `caches.default` replaced by `double`, then puts the slot the
 * process had before it back — including when `run` throws. */
export async function withCacheDouble(double: CacheApiDouble, run: () => Promise<Response> | Response): Promise<Response> {
  const previous = cacheSlot();
  Object.defineProperty(globalThis, "caches", { configurable: true, value: { default: double } });
  try {
    return await run();
  } finally {
    Object.defineProperty(globalThis, "caches", previous);
  }
}

/** A cache that never holds anything, with the case's own `put`: the failure
 * paths assert on the write, and a hit would mask it. */
export function noHitCache(put: CachePut): CacheApiDouble {
  return { match: () => Promise.resolve(undefined), put };
}

/** A cache that answers each GET with what a previous PUT stored — the only way
 * to observe the cache tier from `node --test`. One instance is shared by both
 * requests of a case, so the second request is answered by the first's write. */
export function storingCache(): CacheApiDouble {
  const stored = new Map<string, Response>();
  return {
    match: (key) => Promise.resolve(stored.get(key.url)),
    put: (key, response) => { stored.set(key.url, response); return Promise.resolve(); },
  };
}
