import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ceilingWindowOf,
  UpstreamRequestCeiling,
  type CeilingStore,
  type CeilingStoreFailure,
  type CeilingStoreFailureReporter,
} from "../src/upstream-ceiling.ts";

/**
 * The ceiling is the promise to the upstream: at most N upstream requests in
 * an hour, whatever the caller asks for (#1792) — and since #1810 the count
 * lives in an EXTERNAL STORE, not in the process that happens to be running.
 * A deploy, a secret rotation or a crash no longer starts a fresh hour, and a
 * second instance spends from the same budget as the first.
 *
 * The window is the FIXED UTC CLOCK HOUR the clock names: the key is the hour
 * and nothing about this process, which is what makes two instances agree
 * without coordinating. "100 requests per hour" is what the agreement records,
 * and an hour is a clock hour before it is anything else.
 *
 * The double below is the TEST's, and that is the point: it owns the counts,
 * so it outlives every ceiling built over it — which is how a restart is
 * reproduced without a restart. The ceiling itself carries no state at all.
 */

/** One hour in seconds — the window, in the unit the agreement is written in. */
const HOUR = 60 * 60;

/** A moment inside one hour; the ceiling reads this clock, never the wall clock. */
const T = 1_700_000_100;

interface StoreDouble {
  readonly store: CeilingStore;
  /** One count per window key. The test owns it, so it survives a new ceiling over the same store. */
  readonly counts: Map<string, number>;
  /** Every store failure the ceiling handed to the operator's surface (#1833). */
  readonly failures: CeilingStoreFailure[];
  readonly reporter: CeilingStoreFailureReporter;
  goUnreachable(): void;
  goReachable(): void;
}

/** An external counter the test owns, and can make fail to answer, as a real one does. */
function storeDouble(): StoreDouble {
  const counts = new Map<string, number>();
  const failures: CeilingStoreFailure[] = [];
  let reachable = true;
  return {
    counts,
    failures,
    reporter: (failure) => {
      failures.push(failure);
    },
    goUnreachable: () => {
      reachable = false;
    },
    goReachable: () => {
      reachable = true;
    },
    store: {
      increment: (window) => {
        if (!reachable) return Promise.reject(new Error("the ceiling store did not answer"));
        const count = (counts.get(window) ?? 0) + 1;
        counts.set(window, count);
        return Promise.resolve(count);
      },
    },
  };
}

void describe("UpstreamRequestCeiling", () => {
  void it("grants every request under the limit", async () => {
    const double = storeDouble();
    const ceiling = new UpstreamRequestCeiling(3, double.store, double.reporter, () => T);
    assert.equal(await ceiling.tryAcquire(), "granted");
    assert.equal(await ceiling.tryAcquire(), "granted");
    assert.equal(await ceiling.tryAcquire(), "granted");
  });

  void it("refuses once the limit is reached, without letting the overflow through", async () => {
    const double = storeDouble();
    const ceiling = new UpstreamRequestCeiling(2, double.store, double.reporter, () => T);
    await ceiling.tryAcquire();
    await ceiling.tryAcquire();
    assert.equal(await ceiling.tryAcquire(), "exhausted");
    assert.equal(await ceiling.tryAcquire(), "exhausted");
  });
});

/**
 * The defect #1810 closes: the count used to live in the process, so a restart
 * inside the upstream's hour started a second hour's worth. A restart is a new
 * ceiling object over the same store — nothing else survives a process.
 */
void describe("the count survives the process that made it", () => {
  void it("refuses after a restart in the same hour, on the store's count", async () => {
    const double = storeDouble();
    const before = new UpstreamRequestCeiling(2, double.store, double.reporter, () => T);
    await before.tryAcquire();
    await before.tryAcquire();
    assert.equal(await before.tryAcquire(), "exhausted");

    const after = new UpstreamRequestCeiling(2, double.store, double.reporter, () => T);
    assert.equal(
      await after.tryAcquire(),
      "exhausted",
      "a restarted service admitted another request in the same hour — the ceiling is counting in memory " +
        "again, which is the defect #1810 exists to close",
    );
  });

  void it("shares one budget between two instances over one store", async () => {
    const double = storeDouble();
    const one = new UpstreamRequestCeiling(2, double.store, double.reporter, () => T);
    const two = new UpstreamRequestCeiling(2, double.store, double.reporter, () => T);
    assert.equal(await one.tryAcquire(), "granted");
    assert.equal(await two.tryAcquire(), "granted");
    assert.equal(
      await two.tryAcquire(),
      "exhausted",
      "the second instance granted a third request: each instance is counting under its own key, so the two " +
        "together can spend twice the agreed ceiling (#1810)",
    );
    assert.equal(await one.tryAcquire(), "exhausted");
    assert.deepEqual(
      [...double.counts.keys()],
      [ceilingWindowOf(T)],
      "one window is one key: a key carrying anything about the instance is a second budget",
    );
  });
});

/**
 * Fail closed (#1810): a store the service cannot reach means the service
 * cannot count, and a service that cannot count refuses. Falling back to a
 * local count would silently restore exactly the behaviour this replaced, in
 * the one situation where the promise is already under strain.
 */
void describe("a store that cannot answer", () => {
  void it("refuses rather than counting in memory", async () => {
    const double = storeDouble();
    double.goUnreachable();
    const ceiling = new UpstreamRequestCeiling(100, double.store, double.reporter, () => T);
    assert.equal(
      await ceiling.tryAcquire(),
      "store-unavailable",
      "an unreachable store must refuse: an in-memory fallback would admit requests the store never counted, " +
        "which is the promise #1810 makes the store enforce",
    );
    assert.equal(double.counts.size, 0, "a refusal must not have been counted anywhere");
    assert.deepEqual(
      double.failures,
      [{ code: "unreachable", message: "the ceiling store did not answer" }],
      "the store's own message must reach the operator: a bare catch is what made every diagnostic in the " +
        "store unreachable (#1833)",
    );
  });

  void it("counts in the store again once the store answers", async () => {
    const double = storeDouble();
    double.goUnreachable();
    const ceiling = new UpstreamRequestCeiling(1, double.store, double.reporter, () => T);
    assert.equal(await ceiling.tryAcquire(), "store-unavailable");
    double.goReachable();
    assert.equal(await ceiling.tryAcquire(), "granted", "the ceiling reads the store, not a count of its own");
    assert.equal(await ceiling.tryAcquire(), "exhausted");
    assert.deepEqual([...double.counts.values()], [2], "the store's count is the store's, refusals included");
  });
});

/**
 * The window is stated, not implied: it is the fixed UTC clock hour, the key
 * is derived from the clock alone, and it changes at the hour boundary — not
 * an hour after the first request, and not a window sliding behind the last.
 * The boundary is asserted on the key, and the behaviour across it through a
 * store, so a change to a rolling window has to change these lines.
 */
void describe("the window is the fixed clock hour", () => {
  void it("keys the hour the clock names", () => {
    assert.equal(ceilingWindowOf(T), ceilingWindowOf(T + 100), "one hour, one key");
    assert.equal(ceilingWindowOf(0), ceilingWindowOf(HOUR - 1), "the first hour of the epoch is one window");
    assert.notEqual(ceilingWindowOf(HOUR - 1), ceilingWindowOf(HOUR), "the key changes at the hour boundary");
  });

  void it("starts the next hour's budget at the boundary, under a new key", async () => {
    let now = T;
    const double = storeDouble();
    const ceiling = new UpstreamRequestCeiling(1, double.store, double.reporter, () => now);
    assert.equal(await ceiling.tryAcquire(), "granted");
    assert.equal(await ceiling.tryAcquire(), "exhausted");
    now = (Math.floor(T / HOUR) + 1) * HOUR;
    assert.equal(await ceiling.tryAcquire(), "granted");
    assert.equal(double.counts.size, 2, "the next hour is a second window, and it has its own key");
  });
});
