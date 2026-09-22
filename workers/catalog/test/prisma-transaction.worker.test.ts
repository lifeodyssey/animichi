import { describe, expect, it, vi } from "vitest";
import type { CatalogRuntime } from "../src/db/prisma";
import { catalogPrisma, inCatalogTransaction } from "../src/db/prisma";

/**
 * The transaction the `db.batch` became (#1630, spec §2.3).
 *
 * neon-http had no client transaction, so an atomic unit was a batch of
 * statements; the Prisma plane has a real one, and every multi-statement publish
 * (`enrich`, `publishVersion`) now runs inside it. The three properties that
 * matter are all boundary properties, so they are stated here rather than at a
 * call site:
 *
 *   - a resolving `fn` COMMITS and the value comes back;
 *   - a throwing `fn` ROLLS BACK, and the throw still reaches the caller;
 *   - a rollback that itself fails EVICTS the connection, because the driver
 *     says the socket is indeterminate and reusing it would poison the next
 *     statement on that runtime — and an EVICTED connection is NOT also
 *     released, since a second teardown after destroy is caller error;
 *   - a `release` that fails on the SUCCESS path is a teardown failure, not a
 *     unit failure: no rollback on a transaction that already committed, and
 *     exactly one release;
 *   - a `destroy` that itself fails does not replace the unit's error — the
 *     eviction failure rides on that error as `cause`;
 *   - a transaction that cannot even be OPENED still releases the connection,
 *     so a failed BEGIN does not hold pool capacity until the request ends.
 *
 * Otherwise the connection is released on every path, so a request that failed
 * mid-transaction does not leak its socket.
 */

/** A runtime whose connection and transaction are observable. */
function fakeRuntime(): {
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

describe("inCatalogTransaction", () => {
  it("commits when the body resolves and returns its value", async () => {
    const fake = fakeRuntime();

    await expect(inCatalogTransaction(fake.runtime, () => Promise.resolve("published"))).resolves.toBe("published");

    expect(fake.commit).toHaveBeenCalledTimes(1);
    expect(fake.rollback).not.toHaveBeenCalled();
    expect(fake.release).toHaveBeenCalledTimes(1);
  });

  it("rolls back when the body throws, and the throw still reaches the caller", async () => {
    const fake = fakeRuntime();

    await expect(inCatalogTransaction(fake.runtime, () => Promise.reject(new Error("enrich failed"))))
      .rejects.toThrow("enrich failed");

    expect(fake.commit).not.toHaveBeenCalled();
    expect(fake.rollback).toHaveBeenCalledTimes(1);
    expect(fake.release).toHaveBeenCalledTimes(1);
    expect(fake.destroy).not.toHaveBeenCalled();
  });

  it("hands the body a seam bound to the open transaction, and does not nest", async () => {
    const fake = fakeRuntime();
    let inner: unknown;

    await inCatalogTransaction(fake.runtime, (query) => {
      inner = query;
      return query.transaction(() => Promise.resolve("inner"));
    });

    // The body saw the seam the helper built, not the runtime it was given...
    expect(inner).not.toBe(fake.runtime);
    // ...and nesting opened NO second transaction: a helper that did would make
    // the atomicity it promises a lie (Postgres has no nested transactions).
    expect(fake.commit).toHaveBeenCalledTimes(1);
  });
});

describe("inCatalogTransaction teardown", () => {
  it("evicts the connection when the rollback itself fails, and does not release it", async () => {
    const fake = fakeRuntime();
    fake.rollback.mockRejectedValue(new Error("connection lost"));

    await expect(inCatalogTransaction(fake.runtime, () => Promise.reject(new Error("enrich failed"))))
      .rejects.toThrow("enrich failed");

    // The socket is indeterminate: reuse would poison the next statement, and
    // the driver's connection contract calls a second teardown after destroy
    // caller error — so the eviction replaces the release.
    expect(fake.destroy).toHaveBeenCalledTimes(1);
    expect(fake.release).not.toHaveBeenCalled();
  });
});

describe("inCatalogTransaction teardown failures", () => {
  it("reports a failing release on the success path as teardown, not as unit failure", async () => {
    const fake = fakeRuntime();
    const releaseFailure = new Error("release failed");
    fake.release.mockRejectedValueOnce(releaseFailure);

    await expect(inCatalogTransaction(fake.runtime, () => Promise.resolve("published"))).rejects.toBe(releaseFailure);

    // The unit COMMITTED, so a teardown failure must not be read as a unit
    // failure: `settleFailed` would roll back a settled transaction — a bare
    // `ROLLBACK` outside one is a WARNING, not an error — and then release a
    // SECOND time.
    expect(fake.commit).toHaveBeenCalledTimes(1);
    expect(fake.rollback).not.toHaveBeenCalled();
    expect(fake.release).toHaveBeenCalledTimes(1);
  });
});

describe("inCatalogTransaction eviction failures", () => {
  it("keeps the unit's error when the eviction also fails, with the eviction failure on its cause", async () => {
    const fake = fakeRuntime();
    const original = new Error("enrich failed");
    const evictionFailure = new Error("destroy failed");
    fake.rollback.mockRejectedValue(new Error("connection lost"));
    fake.destroy.mockRejectedValue(evictionFailure);

    await expect(inCatalogTransaction(fake.runtime, () => Promise.reject(original))).rejects.toBe(original);

    // The eviction failure is context, not a substitute: the driver's contract
    // leaves a connection whose teardown failed retryable, so the error the
    // unit threw is the one the caller gets back.
    expect(original.cause).toBe(evictionFailure);
    expect(fake.destroy).toHaveBeenCalledTimes(1);
    expect(fake.release).not.toHaveBeenCalled();
  });

  it("keeps a frozen error that cannot carry the eviction failure", async () => {
    const fake = fakeRuntime();
    const original = Object.freeze(new Error("enrich failed"));
    fake.rollback.mockRejectedValue(new Error("connection lost"));
    fake.destroy.mockRejectedValue(new Error("destroy failed"));

    // Attaching the cause must not ITSELF become the failure: a frozen error
    // cannot carry one, and the error the unit threw still wins.
    await expect(inCatalogTransaction(fake.runtime, () => Promise.reject(original))).rejects.toBe(original);
  });
});

describe("inCatalogTransaction connection lifecycle", () => {
  it("releases the connection when the transaction cannot even be opened", async () => {
    const fake = fakeRuntime();
    fake.openTransaction.mockRejectedValue(new Error("BEGIN failed"));

    await expect(inCatalogTransaction(fake.runtime, () => Promise.resolve("unused")))
      .rejects.toThrow("BEGIN failed");

    // No transaction was opened, so the connection is still clean: release it
    // rather than holding it until the request-scoped runtime is disposed.
    expect(fake.release).toHaveBeenCalledTimes(1);
    expect(fake.rollback).not.toHaveBeenCalled();
    expect(fake.destroy).not.toHaveBeenCalled();
  });
});

describe("catalogPrisma", () => {
  it("pairs the shared builder with one request's runtime", () => {
    const fake = fakeRuntime();

    const seam = catalogPrisma(fake.runtime);

    expect(seam.executor).toBe(fake.runtime);
    // The builder is the contract-bound statement builder, not a per-request
    // object: building a plan binds no connection.
    expect(seam.builder).toBe(catalogPrisma(fake.runtime).builder);
  });
});
