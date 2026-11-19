import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  UpstreamRequestCeiling,
  type Admission,
  type AdmissionRequest,
  type CeilingStore,
  type CeilingStoreFailure,
  type CeilingStoreFailureReporter,
} from "../src/upstream-ceiling.ts";

/**
 * SUT: `UpstreamRequestCeiling`, the promise to the upstream as the handler
 * asks it: at most the limit of upstream requests in any 3600 seconds, whatever
 * the caller asks for (#1792). Since #1810 the count lives in an EXTERNAL
 * STORE, which keeps the rolling window and decides each admission itself
 * (`rolling-window-script.ts`, proven on a real Redis in
 * `rolling-window*.integration.test.ts`). The ceiling asks it once per request,
 * with the limit and the egress's clock, and turns its answer into one of
 * exactly three outcomes. The ceiling itself carries no state at all.
 *
 * The double below is the TEST's: it answers what the test tells it to and
 * records what it was asked, so these cases read the ceiling and nothing else.
 */

interface StoreDouble {
  readonly store: CeilingStore;
  /** Every request the ceiling made of the store, in order. */
  readonly asked: AdmissionRequest[];
  /** Every store failure the ceiling handed to the operator's surface (#1833). */
  readonly failures: CeilingStoreFailure[];
  readonly reporter: CeilingStoreFailureReporter;
  goUnreachable(): void;
  goReachable(): void;
}

/** A store that answers `answers` in turn, and can be made to fail to answer, as a real one does. */
function storeDouble(answers: readonly Admission[] = []): StoreDouble {
  const queue = [...answers];
  const asked: AdmissionRequest[] = [];
  const failures: CeilingStoreFailure[] = [];
  let reachable = true;
  return {
    asked,
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
      admit: (request) => {
        asked.push(request);
        if (!reachable) return Promise.reject(new Error("the ceiling store did not answer"));
        return Promise.resolve(queue.shift() ?? "refused");
      },
    },
  };
}

void describe("UpstreamRequestCeiling", () => {
  void it("grants what the store admits, and refuses what it refuses", async () => {
    const double = storeDouble(["admitted", "refused", "admitted"]);
    const ceiling = new UpstreamRequestCeiling(3, double.store, double.reporter, () => 0);
    const decisions = [await ceiling.tryAcquire(), await ceiling.tryAcquire(), await ceiling.tryAcquire()];
    assert.deepEqual(decisions, ["granted", "exhausted", "granted"]);
  });

  void it("asks the store with its own limit and a fresh read of its clock on every request", async () => {
    let now = 1_700_000_000;
    const double = storeDouble(["admitted", "admitted"]);
    const ceiling = new UpstreamRequestCeiling(3, double.store, double.reporter, () => now);
    await ceiling.tryAcquire();
    now += 61;
    await ceiling.tryAcquire();
    assert.deepEqual(double.asked, [
      { nowSeconds: 1_700_000_000, limit: 3 },
      { nowSeconds: 1_700_000_061, limit: 3 },
    ]);
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
    const double = storeDouble(["admitted"]);
    double.goUnreachable();
    const ceiling = new UpstreamRequestCeiling(100, double.store, double.reporter, () => 0);
    assert.equal(
      await ceiling.tryAcquire(),
      "store-unavailable",
      "an unreachable store must refuse: an in-memory fallback would admit requests the store never counted, " +
        "which is the promise #1810 makes the store enforce",
    );
    assert.deepEqual(
      double.failures,
      [{ code: "unreachable", message: "the ceiling store did not answer" }],
      "the store's own message must reach the operator: a bare catch is what made every diagnostic in the " +
        "store unreachable (#1833)",
    );
  });

  void it("asks the store again once it answers, and reads its answer, not a count of its own", async () => {
    const double = storeDouble(["admitted", "refused"]);
    double.goUnreachable();
    const ceiling = new UpstreamRequestCeiling(1, double.store, double.reporter, () => 0);
    assert.equal(await ceiling.tryAcquire(), "store-unavailable");
    double.goReachable();
    assert.equal(await ceiling.tryAcquire(), "granted");
    assert.equal(await ceiling.tryAcquire(), "exhausted");
  });
});
