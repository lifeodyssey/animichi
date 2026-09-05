/**
 * W1-2 (#1251) against real PostgreSQL: WHICH runs the sweep re-arms, and that
 * neither kind of stranded run can starve the other.
 *
 * The predicate is SQL, so a double could only lie about it. Seeded rows cover
 * all four states a `runs` row can be in when the sweep looks: never leased
 * (the crash between COMMIT and `setAlarm` the backstop exists for), lease
 * expired, lease still held, and terminal — the last with an expired lease on
 * purpose, so the status filter is proven independently of the lease filter.
 *
 * The starvation case is why the read is two capped branches rather than one
 * ordered batch: PostgreSQL sorts NULLs last, so a single
 * `ORDER BY lease_expires_at LIMIT n` behind a backlog of n expired leases
 * would never return a never-leased run at all. The batch size is injected so
 * the case needs a handful of rows instead of a hundred.
 *
 * test-type: integration (disposable Docker PostgreSQL, committed Atlas chain).
 */
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { NeonRunLeases } from "../src/agent/sweeper/neon-run-leases.ts";
import { SETUP_HOOK_TIMEOUT_MS, startAgentDataPlane, type AgentDataPlane } from "./postgres-arm.ts";
import { seedRun } from "./agent-rows.ts";

const NOW = Date.parse("2026-09-02T23:30:00.000Z");
const JUST_EXPIRED = new Date(NOW - 1).toISOString();
const STILL_LIVE = new Date(NOW + 1).toISOString();
/** Enough expired leases to fill a small batch on their own. */
const BACKLOG = 4;

let plane: AgentDataPlane;
let neverLeased: string;
let expired: string;

before(async () => {
  plane = await startAgentDataPlane();
  expired = await seedRun(plane.database, { sessionId: "expired-lease", status: "running", leaseExpiresAt: JUST_EXPIRED });
  neverLeased = await seedRun(plane.database, { sessionId: "never-armed", status: "running", leaseExpiresAt: null });
  await seedRun(plane.database, { sessionId: "held-lease", status: "running", leaseExpiresAt: STILL_LIVE });
  await seedRun(plane.database, { sessionId: "settled", status: "succeeded", leaseExpiresAt: JUST_EXPIRED });
}, { timeout: SETUP_HOOK_TIMEOUT_MS });

after(() => plane.stop(), { timeout: 60_000 });

/** The swept runs, ordered by run id so the assertion does not depend on which
 * branch of the read produced them. */
async function sweptRuns(batchSize?: number): Promise<{ runId: string; sessionId: string }[]> {
  const leases = new NeonRunLeases(plane.transactions, batchSize);
  const stranded = await leases.withoutLiveLease(NOW);
  return [...stranded].sort((left, right) => left.runId.localeCompare(right.runId));
}

void test("the sweep sees exactly the running runs no live lease covers", async () => {
  const expected = [
    { runId: expired, sessionId: "expired-lease" },
    { runId: neverLeased, sessionId: "never-armed" },
  ].sort((left, right) => left.runId.localeCompare(right.runId));
  assert.deepEqual(await sweptRuns(), expected);
});

void test("a lease that expires one millisecond from now is still a live lease", async () => {
  const leases = new NeonRunLeases(plane.transactions);
  const stranded = await leases.withoutLiveLease(NOW - 1);
  assert.deepEqual(stranded.map((run) => run.sessionId), ["never-armed"]);
});

void test("a backlog of expired leases never crowds out the never-leased runs", async () => {
  for (let index = 0; index < BACKLOG; index++) {
    await seedRun(plane.database, {
      sessionId: `backlog-${String(index)}`,
      status: "running",
      leaseExpiresAt: new Date(NOW - 1_000 - index).toISOString(),
    });
  }
  const swept = await sweptRuns(2);
  assert.ok(swept.some((run) => run.runId === neverLeased), "the never-leased run must still be swept");
  assert.equal(swept.length, 2, "the injected batch size still bounds the alarm's work");
});
