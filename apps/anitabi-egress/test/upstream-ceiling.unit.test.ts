import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { UpstreamRequestCeiling } from "../src/upstream-ceiling.ts";

/**
 * The ceiling is the promise to the upstream: at most N upstream requests in
 * any hour, whatever the caller asks for (#1792). It is not a tuning knob —
 * it defends the allowlisted address from our own bugs too (#1784).
 */

void describe("UpstreamRequestCeiling", () => {
  void it("grants every request under the limit", () => {
    const ceiling = new UpstreamRequestCeiling(3, () => 1000);
    assert.equal(ceiling.tryAcquire(), true);
    assert.equal(ceiling.tryAcquire(), true);
    assert.equal(ceiling.tryAcquire(), true);
  });

  void it("refuses once the limit is reached, without letting the overflow through", () => {
    const ceiling = new UpstreamRequestCeiling(3, () => 1000);
    ceiling.tryAcquire();
    ceiling.tryAcquire();
    ceiling.tryAcquire();
    assert.equal(ceiling.tryAcquire(), false);
    assert.equal(ceiling.tryAcquire(), false);
  });

  void it("grants again once the hour window has elapsed", () => {
    let now = 1000;
    const ceiling = new UpstreamRequestCeiling(2, () => now);
    ceiling.tryAcquire();
    ceiling.tryAcquire();
    assert.equal(ceiling.tryAcquire(), false);
    now += 60 * 60; // exactly one hour later
    assert.equal(ceiling.tryAcquire(), true);
  });

  void it("keeps refusing within the same hour window", () => {
    let now = 1000;
    const ceiling = new UpstreamRequestCeiling(1, () => now);
    assert.equal(ceiling.tryAcquire(), true);
    now += 60 * 59; // a minute short of the hour
    assert.equal(ceiling.tryAcquire(), false);
  });
});
