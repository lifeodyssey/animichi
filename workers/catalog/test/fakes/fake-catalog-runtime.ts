/**
 * A `CatalogRuntime` double — a request's connection — whose pooled connection
 * and transaction are observable (#1839).
 *
 * `inCatalogTransaction`'s contract is about the order and the fate of the
 * calls it makes through one request's connection — open, commit or roll back,
 * then release or destroy — and about the error the caller receives when one of
 * them fails. The real connection is a socket, so a test that wants a failing
 * `release` or `destroy` needs a connection it can break on purpose: this fake
 * hands back `vi.fn()`s and lets each test choose which one rejects.
 *
 * The cast is the seam's own shape rather than an escape hatch. The wrapper
 * reads only `runtime().connection()` from the request's connection (rc.14), and
 * only `transaction()`, `release()` and `destroy()` from what that returns.
 */
import { vi } from "vitest";
import type { CatalogPlanExecutor, CatalogRuntime } from "../../src/db/prisma";

/** A runtime whose connection and transaction are observable. */
export function fakeRuntime(): {
  readonly runtime: CatalogRuntime;
  readonly openTransaction: ReturnType<typeof vi.fn>;
  readonly commit: ReturnType<typeof vi.fn>;
  readonly rollback: ReturnType<typeof vi.fn>;
  readonly release: ReturnType<typeof vi.fn>;
  readonly destroy: ReturnType<typeof vi.fn>;
} {
  const commit = vi.fn(() => Promise.resolve());
  const rollback = vi.fn(() => Promise.resolve());
  const release = vi.fn(() => Promise.resolve());
  const destroy = vi.fn(() => Promise.resolve());
  const openTransaction = vi.fn(() => Promise.resolve({
    query: () => Promise.resolve([] as readonly never[]),
    commit,
    rollback,
  }));
  const connection = {
    transaction: openTransaction,
    release,
    destroy,
  };
  return {
    runtime: { runtime: () => ({ connection: () => Promise.resolve(connection) }) } as unknown as CatalogRuntime,
    openTransaction, commit, rollback, release, destroy,
  };
}

/** A call of a transaction's own that a traced runtime can refuse. */
export type LifecycleCall = "begin" | "commit" | "release";

/** The one transaction call a traced runtime refuses, and what it rejects with. */
export interface LifecycleRefusal {
  readonly call: LifecycleCall;
  readonly error: Error;
}

/**
 * A runtime that runs every statement, outside a transaction and inside one, on
 * `executor`, and writes each transaction call — `begin`, `commit`, `rollback`,
 * `release`, `destroy` — into `trace` as it is made, beside the statements the
 * executor traces there. Where {@link fakeRuntime} counts calls per spy, this
 * keeps their order against the statements. Besides `runtime().connection()` it
 * answers the connection's own `query`, which `catalogPrisma` uses as the
 * executor outside a transaction; the cast is the same seam-shaped one as above.
 */
export function tracedRuntime(executor: CatalogPlanExecutor, trace: string[], refusal?: LifecycleRefusal): CatalogRuntime {
  const step = (call: string) => (): Promise<void> => {
    trace.push(call);
    return refusal?.call === call ? Promise.reject(refusal.error) : Promise.resolve();
  };
  const query: CatalogPlanExecutor["query"] = (plan) => executor.query(plan);
  const transaction = { query, commit: step("commit"), rollback: step("rollback") };
  const connection = {
    transaction: () => step("begin")().then(() => transaction),
    release: step("release"),
    destroy: step("destroy"),
  };
  return { query, runtime: () => ({ connection: () => Promise.resolve(connection) }) } as unknown as CatalogRuntime;
}
