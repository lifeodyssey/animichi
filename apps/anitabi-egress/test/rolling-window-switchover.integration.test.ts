import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import type { StartedTestContainer } from "testcontainers";
import { ceilingOn, decisionsAt, HOUR, redisCli, startRedis } from "./ceiling-over-redis.ts";

/**
 * SUT: the switch from the fixed-hour counter to the rolling window, on a real
 * Redis. The service before the window counted each clock hour in a key of its
 * own, refusals included. When the window finds itself empty — the first
 * request after the deploy — it copies those counts in as placeholder
 * admissions at its own second, capped at the limit, so the requests the old
 * service already relayed are honoured, more conservatively than they
 * happened: each one holds its slot for a full window from the switch.
 *
 * The counters are named by the egress's clock, the clock the old service named
 * them by; the window's seconds are the ceiling's clock here, as everywhere a
 * test owns it.
 */

/** The fixed-hour counter the old service kept for the clock hour starting at `start`. */
function counter(start: number): string {
  return `anitabi-egress:upstream-requests:${String(start)}`;
}

/** The window's key, as an operator would ask the store for it. */
const WINDOW_KEY = "anitabi-egress:upstream-requests:rolling";

void describe("the first request after the switch from the fixed hour", () => {
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

  void it("honours what the old service counted in this hour and the last, until a full window has passed", async () => {
    await redisCli(container, "SET", counter(HOUR - 3600), "7");
    await redisCli(container, "SET", counter(HOUR), "2");
    const clock = { now: 0 };
    const ceiling = ceilingOn(container, 10, clock);
    const decisions = await decisionsAt(ceiling, clock, [HOUR + 600, HOUR + 600, HOUR + 600 + 3600, HOUR + 600 + 3601]);
    assert.deepEqual(
      decisions,
      ["granted", "exhausted", "exhausted", "granted"],
      "nine slots were spent by the old service: one is left, and all ten free together a window after the switch",
    );
  });

  void it("caps what it honours at the limit, however far the old counter ran with refusals", async () => {
    await redisCli(container, "SET", counter(HOUR), "500");
    const clock = { now: 0 };
    const decisions = await decisionsAt(ceilingOn(container, 10, clock), clock, [HOUR + 600]);
    assert.deepEqual(decisions, ["exhausted"]);
    assert.equal(await redisCli(container, "ZCARD", WINDOW_KEY), "10", "placeholders past the limit would change nothing");
  });

  void it("copies nothing when the old service left nothing", async () => {
    const clock = { now: 0 };
    const decisions = await decisionsAt(ceilingOn(container, 2, clock), clock, [HOUR + 600, HOUR + 600, HOUR + 600]);
    assert.deepEqual(decisions, ["granted", "granted", "exhausted"]);
  });

  void it("reads the old counters only while the window is empty", async () => {
    const clock = { now: 0 };
    const ceiling = ceilingOn(container, 3, clock);
    const first = await decisionsAt(ceiling, clock, [HOUR + 600]);
    await redisCli(container, "SET", counter(HOUR), "9");
    const then = await decisionsAt(ceiling, clock, [HOUR + 601, HOUR + 602, HOUR + 603]);
    assert.deepEqual([...first, ...then], ["granted", "granted", "granted", "exhausted"]);
  });
});
