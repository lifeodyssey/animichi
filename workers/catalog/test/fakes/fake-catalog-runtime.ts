/**
 * A `CatalogRuntime` double whose connection and transaction are observable
 * (#1839).
 *
 * `inCatalogTransaction`'s contract is about the order and the fate of the
 * calls it makes on one request's runtime — open, commit or roll back, then
 * release or destroy — and about the error the caller receives when one of them
 * fails. The real runtime is a socket, so a test that wants a failing `release`
 * or `destroy` needs a connection it can break on purpose: this fake hands back
 * `vi.fn()`s and lets each test choose which one rejects.
 *
 * The cast is the seam's own shape rather than an escape hatch. The wrapper
 * reads only `connection()` from the runtime, and only `transaction()`,
 * `release()` and `destroy()` from what that returns.
 */
import { vi } from "vitest";
import type { CatalogRuntime } from "../../src/db/prisma";

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
    runtime: { connection: () => Promise.resolve(connection) } as unknown as CatalogRuntime,
    openTransaction, commit, rollback, release, destroy,
  };
}
