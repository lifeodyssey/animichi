import { describe, expect, it } from "vitest";
import { inCatalogTransaction } from "../src/db/prisma";
import { fakeRuntime } from "./fakes/fake-catalog-runtime";

/**
 * What the caller is left holding when a teardown call fails (#1839).
 *
 * The sibling `prisma-transaction.worker.test.ts` pins WHEN each teardown call
 * happens — one release, a rollback only on a unit failure, `destroy` instead of
 * a second `release` after a failed rollback. This file pins a different
 * property: when one of those calls is the one that fails, the caller still
 * receives the error its own unit threw. `classifyIngestFailure`
 * (`src/ingest/ingest-failure.ts`) is an `instanceof` chain, so it buckets on
 * the error's IDENTITY — a teardown failure substituted for it silently moves
 * the failure to `ingest_error` and writes the teardown's message into the
 * operator row.
 *
 * A release that rejects is the one failure here the installed driver cannot
 * produce: on a direct `pg.Client` connection `release()` has nothing left to
 * await. It is asserted anyway, because that is what the wrapper's doc comment
 * promises and because `inCatalogTransaction` is a seam — a promise that holds
 * only for today's driver is not the promise the comment makes.
 *
 * `attachCause`'s own three promises — the descriptor it writes, what a
 * non-object throw does, and which reading of "already carries a cause" it
 * implements — are asserted in the last suite, since each is a property of what
 * the caller is left holding.
 */
describe("inCatalogTransaction keeps the caller's error", () => {
  it("when the rollback succeeds and the release that follows it fails", async () => {
    const fake = fakeRuntime();
    const original = new Error("enrich failed");
    const releaseFailure = new Error("release failed");
    fake.release.mockRejectedValueOnce(releaseFailure);

    await expect(inCatalogTransaction(fake.runtime, () => Promise.reject(original))).rejects.toBe(original);

    // `settleFailed` says it never throws, so the release failure cannot be what
    // the caller sees: the unit's error is, with the teardown failure recorded
    // on it instead.
    expect(original.cause).toBe(releaseFailure);
    expect(fake.rollback).toHaveBeenCalledTimes(1);
    expect(fake.release).toHaveBeenCalledTimes(1);
    expect(fake.destroy).not.toHaveBeenCalled();
  });

  it("when the transaction cannot be opened and the eviction after it fails", async () => {
    const fake = fakeRuntime();
    const beginFailure = new Error("BEGIN failed");
    const evictionFailure = new Error("destroy failed");
    fake.openTransaction.mockRejectedValueOnce(beginFailure);
    fake.destroy.mockRejectedValueOnce(evictionFailure);

    await expect(inCatalogTransaction(fake.runtime, () => Promise.resolve("unused"))).rejects.toBe(beginFailure);

    // The same property on the arm that never reached a transaction: the failed
    // BEGIN is the caller's error, and the failed eviction is recorded on it.
    expect(beginFailure.cause).toBe(evictionFailure);
    expect(fake.destroy).toHaveBeenCalledTimes(1);
    expect(fake.release).not.toHaveBeenCalled();
    expect(fake.rollback).not.toHaveBeenCalled();
  });

  it("and does not overwrite a cause the unit's error already carries", async () => {
    const fake = fakeRuntime();
    const dbError = new Error("duplicate key violates unique constraint");
    const original = new Error("enrich failed", { cause: dbError });
    fake.rollback.mockRejectedValue(new Error("connection lost"));
    fake.destroy.mockRejectedValue(new Error("destroy failed"));

    await expect(inCatalogTransaction(fake.runtime, () => Promise.reject(original))).rejects.toBe(original);

    // The unit set that cause deliberately and it names what failed UNDERNEATH
    // the unit's error; a teardown failure happens after it, so replacing the
    // origin would destroy the only record of the real failure. The eviction
    // still runs — it is the cause, not the eviction, that is spared.
    expect(original.cause).toBe(dbError);
    expect(fake.destroy).toHaveBeenCalledTimes(1);
  });
});

describe("attachCause records what the caller is left holding", () => {
  it("writes `cause` with the descriptor native `Error.cause` carries", async () => {
    const fake = fakeRuntime();
    const original = new Error("enrich failed");
    const evictionFailure = new Error("destroy failed");
    fake.rollback.mockRejectedValue(new Error("connection lost"));
    fake.destroy.mockRejectedValue(evictionFailure);

    await expect(inCatalogTransaction(fake.runtime, () => Promise.reject(original))).rejects.toBe(original);

    // The descriptor is the property's contract, not decoration: an enumerable
    // `cause` would leak into `JSON.stringify` and every spread of the error.
    expect(Object.getOwnPropertyDescriptor(original, "cause")).toEqual({
      value: evictionFailure, writable: true, enumerable: false, configurable: true,
    });
  });

  it("keeps a non-object throw that cannot carry the eviction failure", async () => {
    const fake = fakeRuntime();
    const thrown: unknown = "enrich failed";
    fake.rollback.mockRejectedValue(new Error("connection lost"));
    fake.destroy.mockRejectedValue(new Error("destroy failed"));

    // A primitive cannot take the property at all. Discovering that must not
    // become the failure, so the caller still receives its own throw.
    await expect(inCatalogTransaction(fake.runtime, () => {
      throw thrown;
    })).rejects.toBe(thrown);

    expect(fake.destroy).toHaveBeenCalledTimes(1);
  });

  it("records the eviction failure on an error whose `cause` is present but undefined", async () => {
    const fake = fakeRuntime();
    const original = new Error("enrich failed", { cause: undefined });
    const evictionFailure = new Error("destroy failed");
    fake.rollback.mockRejectedValue(new Error("connection lost"));
    fake.destroy.mockRejectedValue(evictionFailure);

    await expect(inCatalogTransaction(fake.runtime, () => Promise.reject(original))).rejects.toBe(original);

    // "Already carries one" is decided by VALUE, not by the key's presence: a
    // `cause` holding `undefined` names no underlying failure to protect, so
    // the eviction failure is recorded where a real cause would be spared.
    expect(original.cause).toBe(evictionFailure);
  });
});
