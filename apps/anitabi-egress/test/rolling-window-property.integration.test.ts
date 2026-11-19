import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { StartedTestContainer } from "testcontainers";
import type { CeilingDecision } from "../src/upstream-ceiling.ts";
import { ceilingOn, decisionsAt, HOUR, startRedis } from "./ceiling-over-redis.ts";

/**
 * SUT: the ceiling's rolling window on a real Redis, under arrivals no case
 * was written for. A fixed seed draws real arrival times at sub-second
 * precision, in bursts and lulls across hour boundaries. Each time is floored
 * to the second the egress's clock would read, which is what the ceiling is
 * given, and the promise is then checked against the REAL times: no closed
 * 3600 seconds of real time admitted more than the limit. Flooring is where an
 * off-by-one at the window's edge would hide, which is why the arrivals are not
 * whole seconds.
 *
 * Two more facts keep the property honest. The decisions must equal a sliding
 * log's over the same seconds, so the window is neither looser nor stricter
 * than its rule. And both outcomes must occur: a window that refused
 * everything would meet the limit trivially.
 */

const SEED = 20_261_120;
const LIMIT = 20;
const ARRIVALS = 400;

/** mulberry32: a small seeded generator, so a failure here replays exactly. */
function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** The gap to the next arrival: a quarter are bursts under a second, the rest lulls of up to a minute. */
function gap(random: () => number): number {
  return random() < 0.25 ? random() * 0.8 : random() * 60;
}

/** Real arrival times, sub-second, from a quarter-hour before an hour boundary, about two and a half hours long. */
function arrivals(random: () => number): number[] {
  const times: number[] = [];
  for (let at = HOUR - 900 + random(); times.length < ARRIVALS; at += gap(random)) times.push(at);
  return times;
}

/** The window's rule over the same seconds: admit while fewer than LIMIT admissions are 3600 seconds old or younger. */
function slidingLog(seconds: readonly number[]): CeilingDecision[] {
  const admitted: number[] = [];
  return seconds.map((now) => {
    const open = admitted.filter((at) => at >= now - 3600).length < LIMIT;
    admitted.push(...(open ? [now] : []));
    return open ? "granted" : "exhausted";
  });
}

/** The most admissions any closed 3600-second span of real time holds. */
function busiestHour(admittedAt: readonly number[]): number {
  return Math.max(...admittedAt.map((start) => admittedAt.filter((at) => at >= start && at <= start + 3600).length));
}

void describe("the rolling window under seeded random arrivals", () => {
  let container: StartedTestContainer;

  before(async () => {
    container = await startRedis();
  });

  after(async () => {
    await container.stop();
  });

  void it("never admits more than the limit in any 3600 seconds of real time", async () => {
    const real = arrivals(seededRandom(SEED));
    const seconds = real.map((at) => Math.floor(at));
    const clock = { now: 0 };
    const decisions = await decisionsAt(ceilingOn(container, LIMIT, clock), clock, seconds);
    const admittedAt = real.filter((_, index) => decisions[index] === "granted");
    assert.deepEqual(decisions, slidingLog(seconds), "the window must decide exactly as its rule does");
    assert.ok(busiestHour(admittedAt) <= LIMIT, `a 3600-second span admitted ${String(busiestHour(admittedAt))}`);
    assert.deepEqual([...new Set(decisions)].sort(), ["exhausted", "granted"], "both outcomes must occur");
  });
});
