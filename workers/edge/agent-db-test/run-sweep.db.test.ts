/**
 * W1-2 (#1251) against real PostgreSQL: WHICH runs the sweep re-arms.
 *
 * The predicate is SQL over `idx_runs_sweep`, so a double could only lie about
 * it. Seeded rows cover all four states a `runs` row can be in when the sweep
 * looks: never leased (the crash between COMMIT and `setAlarm` the backstop
 * exists for), lease expired, lease still held, and terminal — the last with
 * an expired lease on purpose, so the status filter is proven independently of
 * the lease filter.
 *
 * test-type: integration (disposable Docker PostgreSQL, committed Atlas chain).
 */
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { NeonRunLeases } from "../src/agent/sweeper/neon-run-leases.ts";
import { startAgentDataPlane, type AgentDataPlane } from "./postgres-arm.ts";
import { seedRun } from "./agent-rows.ts";

const NOW = Date.parse("2026-09-02T23:30:00.000Z");
const JUST_EXPIRED = new Date(NOW - 1).toISOString();
const STILL_LIVE = new Date(NOW + 1).toISOString();

let plane: AgentDataPlane;
let neverLeased: string;
let expired: string;

before(async () => {
  plane = await startAgentDataPlane();
  expired = await seedRun(plane.database, { sessionId: "expired-lease", status: "running", leaseExpiresAt: JUST_EXPIRED });
  neverLeased = await seedRun(plane.database, { sessionId: "never-armed", status: "running", leaseExpiresAt: null });
  await seedRun(plane.database, { sessionId: "held-lease", status: "running", leaseExpiresAt: STILL_LIVE });
  await seedRun(plane.database, { sessionId: "settled", status: "succeeded", leaseExpiresAt: JUST_EXPIRED });
}, { timeout: 300_000 });

after(() => plane.stop(), { timeout: 60_000 });

void test("the sweep sees exactly the running runs no live lease covers, oldest lease first", async () => {
  const stranded = await new NeonRunLeases(plane.transactions).withoutLiveLease(NOW);
  assert.deepEqual(stranded, [
    { runId: expired, sessionId: "expired-lease" },
    { runId: neverLeased, sessionId: "never-armed" },
  ]);
});

void test("a lease that expires one millisecond from now is still a live lease", async () => {
  const stranded = await new NeonRunLeases(plane.transactions).withoutLiveLease(NOW - 1);
  assert.deepEqual(stranded.map((run) => run.sessionId), ["never-armed"]);
});
