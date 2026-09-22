import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  UpstreamRequestCeiling,
  type CeilingStore,
  type CeilingStoreFailure,
  type CeilingStoreFailureReporter,
} from "../src/upstream-ceiling.ts";

/**
 * A reporter that throws (the #1849 bot finding on line 154): the refusal is
 * the ceiling's contract with the caller and the operator's line is a courtesy,
 * so a reporter's own failure must never be able to trade one for the other —
 * `tryAcquire` must still resolve to one of the three outcomes, whatever the
 * reporter does.
 *
 * The ceiling enforces that itself, at the one place the reporter enters the
 * object, so no caller ever has to guard its call and no future call site can
 * forget to. These tests install a deliberately broken reporter — one that
 * receives the failure and THEN throws, as a closed stderr or a caller's
 * throwing sink would — and hold the three outcomes against it.
 */

/** A moment inside one hour; the ceiling reads this clock, never the wall clock. */
const T = 1_700_000_100;

/** A store that fails the way an unreachable one does (#1833's own fixture). */
function failingStore(): CeilingStore {
  return { increment: () => Promise.reject(new Error("the ceiling store did not answer")) };
}

/** A store that counts, for the answers a reporter must never reach. */
function countingStore(): CeilingStore {
  const counts = new Map<string, number>();
  return {
    increment: (window) => {
      const count = (counts.get(window) ?? 0) + 1;
      counts.set(window, count);
      return Promise.resolve(count);
    },
  };
}

/** A reporter that is given the failure and then throws, as a broken sink does. */
function reporterThatThrows(seen: CeilingStoreFailure[]): CeilingStoreFailureReporter {
  return (failure) => {
    seen.push(failure);
    throw new Error("the reporter's own channel is broken");
  };
}

void describe("a reporter that throws", () => {
  void it("cannot trade the caller's refusal for the courtesy line", async () => {
    const seen: CeilingStoreFailure[] = [];
    const ceiling = new UpstreamRequestCeiling(100, failingStore(), reporterThatThrows(seen), () => T);
    const decision = await ceiling.tryAcquire();
    assert.equal(
      decision,
      "store-unavailable",
      "a store failure must reach the caller as the refusal, even while the reporter throws",
    );
    assert.equal(
      seen.length,
      1,
      "containment must not become silence: the reporter was still called with the failure",
    );
    assert.deepEqual(seen[0], { code: "unreachable", message: "the ceiling store did not answer" });
  });

  void it("cannot reach into an answer the store granted", async () => {
    const seen: CeilingStoreFailure[] = [];
    const ceiling = new UpstreamRequestCeiling(1, countingStore(), reporterThatThrows(seen), () => T);
    assert.equal(await ceiling.tryAcquire(), "granted");
    assert.equal(await ceiling.tryAcquire(), "exhausted");
    assert.deepEqual(seen, [], "a granted request reports nothing, so a throwing reporter is never called");
  });
});
