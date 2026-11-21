import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import type { StartedTestContainer } from "testcontainers";
import { UpstreamRequestCeiling } from "../src/upstream-ceiling.ts";
import { ceilingOn, decisionsAt, HOUR, redisCli, serviceStoreOn, startRedis } from "./ceiling-over-redis.ts";

/**
 * SUT: the ceiling's rolling window, as the store runs it — the window's
 * script on a real Redis, reached through the production store and asked
 * through the ceiling. Any 3600 seconds hold at most the limit: an admission at
 * second `s` still counts at `s + 3600` and frees its slot at `s + 3601`, so a
 * budget filled at :59 is not spent again at the top of the hour.
 *
 * The ceiling's clock is the test's, injected as the window's prologue; the
 * second suite also runs the service's own prologue, the store's `TIME`.
 */

/** The window's key, as an operator would ask the store for it. */
const WINDOW_KEY = "anitabi-egress:upstream-requests:rolling";

void describe("the rolling window, on a real Redis", () => {
  let container: StartedTestContainer;

  before(async () => {
    container = await startRedis();
  });

  after(async () => {
    await container.stop();
  });

  beforeEach(async () => {
    await redisCli(container, "FLUSHDB");
  });

  void it("refuses at the top of the next hour a window filled at :59, until its oldest admission ages out", async () => {
    const clock = { now: 0 };
    const ceiling = ceilingOn(container, 3, clock);
    const filled = await decisionsAt(ceiling, clock, [HOUR + 3540, HOUR + 3541, HOUR + 3542]);
    const next = await decisionsAt(ceiling, clock, [HOUR + 3600, HOUR + 3540 + 3600, HOUR + 3540 + 3601, HOUR + 3540 + 3601]);
    assert.deepEqual(filled, ["granted", "granted", "granted"]);
    assert.deepEqual(
      next,
      ["exhausted", "exhausted", "granted", "exhausted"],
      "the hour's top must not reopen the budget: one slot frees at 3601 s, when the oldest admission ages out",
    );
  });

  void it("admits nothing more when its clock steps back across an hour", async () => {
    const clock = { now: 0 };
    const ceiling = ceilingOn(container, 2, clock);
    const decisions = await decisionsAt(ceiling, clock, [HOUR + 60, HOUR + 61, HOUR - 60, HOUR + 60 + 3600, HOUR + 60 + 3601]);
    assert.deepEqual(
      decisions,
      ["granted", "granted", "exhausted", "exhausted", "granted"],
      "admissions the clock now puts in the future still count, until it passes them by the full window",
    );
  });

  void it("admits a concurrent batch exactly up to what the window has left, and records no refusal", async () => {
    const clock = { now: 0 };
    const ceiling = ceilingOn(container, 5, clock);
    await decisionsAt(ceiling, clock, [HOUR + 600, HOUR + 600, HOUR + 600]);
    const batch = await Promise.all(Array.from({ length: 6 }, () => ceiling.tryAcquire()));
    assert.equal(batch.filter((decision) => decision === "granted").length, 2);
    assert.equal(batch.filter((decision) => decision === "exhausted").length, 4);
    assert.equal(await redisCli(container, "ZCARD", WINDOW_KEY), "5", "a refusal recorded would keep the window full");
  });
});

void describe("whose clock, and whose window, on a real Redis", () => {
  let container: StartedTestContainer;

  before(async () => {
    container = await startRedis();
  });

  after(async () => {
    await container.stop();
  });

  beforeEach(async () => {
    await redisCli(container, "FLUSHDB");
  });

  void it("runs on the store's own clock in the service, recording each admission at the store's second", async () => {
    const first = await serverSecond(container);
    const ceiling = new UpstreamRequestCeiling(2, serviceStoreOn(container), () => undefined, () => 0);
    const decisions = [await ceiling.tryAcquire(), await ceiling.tryAcquire(), await ceiling.tryAcquire()];
    const last = await serverSecond(container);
    const scores = await scoresIn(container);
    assert.deepEqual(decisions, ["granted", "granted", "exhausted"]);
    assert.equal(scores.length, 2);
    assert.ok(
      scores.every((score) => score >= first && score <= last),
      `the window's seconds must be the store's (${String(first)}..${String(last)}), not this machine's: ${scores.join(", ")}`,
    );
  });

  void it("runs on the test's own clock when a test hands it one, which every other case relies on", async () => {
    const clock = { now: HOUR + 1200 };
    await ceilingOn(container, 1, clock).tryAcquire();
    assert.deepEqual(await scoresIn(container), [HOUR + 1200]);
  });

  void it("shares one window between two instances of the service", async () => {
    const clock = { now: HOUR + 900 };
    const one = ceilingOn(container, 2, clock);
    const two = ceilingOn(container, 2, clock);
    const decisions = [await one.tryAcquire(), await two.tryAcquire(), await two.tryAcquire(), await one.tryAcquire()];
    assert.deepEqual(decisions, ["granted", "granted", "exhausted", "exhausted"]);
  });
});

/** The store's own second, as its `TIME` reports it. */
async function serverSecond(container: StartedTestContainer): Promise<number> {
  const [seconds] = (await redisCli(container, "TIME")).split("\n");
  return Number(seconds);
}

/** The seconds the window's members are scored at, oldest first. */
async function scoresIn(container: StartedTestContainer): Promise<number[]> {
  const pairs = (await redisCli(container, "ZRANGE", WINDOW_KEY, "0", "-1", "WITHSCORES")).split("\n");
  return pairs.filter((_, index) => index % 2 === 1).map(Number);
}
