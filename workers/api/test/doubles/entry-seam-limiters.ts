/**
 * The two limiter bindings a characterization pin's request can reach, as
 * recording doubles writing into the case's ordered log: the coarse damper
 * (`RATE_LIMITER`, one `coarse <key>` line per call) and the durable guard
 * shards (`EDGE_GUARD`, one `<shard> <method> <path>` line per call). A case
 * plans how many calls each allows before it denies, or makes it "down" so its
 * call throws. Both meter per key, as the ratelimit binding counts per key and
 * each durable shard is its own object.
 */
import type { Env } from "../../src/env.ts";

/** How many calls a limiter allows before it denies, or "down" for one whose call throws. */
export type Capacity = number | "down";

export interface LimiterPlan {
  readonly coarse: Capacity;
  readonly durable: Capacity;
}

export const UNLIMITED: LimiterPlan = { coarse: Number.POSITIVE_INFINITY, durable: Number.POSITIVE_INFINITY };
export const LIMITED: LimiterPlan = { coarse: 0, durable: 0 };

/** What a denying durable shard tells the gateway to wait. */
const SHARD_RETRY_AFTER_SECONDS = 17;

/** What each key has left of one limiter's capacity. */
class Allowance {
  readonly #spent = new Map<string, number>();

  constructor(readonly capacity: number) {}

  spend(key: string): boolean {
    const spent = this.#spent.get(key) ?? 0;
    this.#spent.set(key, spent + 1);
    return spent < this.capacity;
  }
}

function allowance(capacity: Capacity): Allowance {
  return new Allowance(capacity === "down" ? 0 : capacity);
}

export function nativeLimiter(log: string[], capacity: Capacity): RateLimit {
  const left = allowance(capacity);
  return {
    limit: ({ key }) => {
      log.push(`coarse ${key}`);
      return capacity === "down" ? Promise.reject(new Error("rate limiter down")) : Promise.resolve({ success: left.spend(key) });
    },
  };
}

/** A budget shard reads "not latched"; a rate shard spends one call of its own capacity. */
function shardAnswer(capacity: Capacity, left: Allowance, shard: string, pathname: string): Promise<Response> {
  if (capacity === "down") return Promise.reject(new Error("guard shard down"));
  const verdict = pathname === "/budget"
    ? { latched: false }
    : { allowed: left.spend(shard), retryAfterSeconds: SHARD_RETRY_AFTER_SECONDS };
  return Promise.resolve(Response.json(verdict));
}

export function guardNamespace(log: string[], capacity: Capacity): Env["EDGE_GUARD"] {
  const left = allowance(capacity);
  return {
    idFromName: (name) => name as unknown as DurableObjectId,
    get: (id) => ({
      fetch: (request) => {
        const { pathname } = new URL(request.url);
        log.push(`${String(id)} ${request.method} ${pathname}`);
        return shardAnswer(capacity, left, String(id), pathname);
      },
    }),
  };
}
