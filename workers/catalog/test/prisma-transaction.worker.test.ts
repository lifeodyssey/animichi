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
 *     statement on that runtime.
 *
 * The connection is also released on every path, so a request that failed
 * mid-transaction does not leak its socket.
 */

/** A runtime whose connection and transaction are observable. */
function fakeRuntime(): {
  readonly runtime: CatalogRuntime;
  readonly commit: ReturnType<typeof vi.fn>;
  readonly rollback: ReturnType<typeof vi.fn>;
  readonly release: ReturnType<typeof vi.fn>;
  readonly destroy: ReturnType<typeof vi.fn>;
} {
  const commit = vi.fn(() => Promise.resolve());
  const rollback = vi.fn(() => Promise.resolve());
  const release = vi.fn(() => Promise.resolve());
  const destroy = vi.fn(() => Promise.resolve());
  const connection = {
    transaction: () => Promise.resolve({
      query: () => Promise.resolve([] as readonly never[]),
      commit,
      rollback,
    }),
    release,
    destroy,
  };
  return { runtime: { connection: () => Promise.resolve(connection) } as unknown as CatalogRuntime, commit, rollback, release, destroy };
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

  it("evicts the connection when the rollback itself fails", async () => {
    const fake = fakeRuntime();
    fake.rollback.mockRejectedValue(new Error("connection lost"));

    await expect(inCatalogTransaction(fake.runtime, () => Promise.reject(new Error("enrich failed"))))
      .rejects.toThrow("enrich failed");

    // The socket is indeterminate: reuse would poison the next statement.
    expect(fake.destroy).toHaveBeenCalledTimes(1);
    expect(fake.release).toHaveBeenCalledTimes(1);
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
