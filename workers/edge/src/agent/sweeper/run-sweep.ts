/**
 * The sweep itself: re-arm every committed turn nobody is running (spec
 * `docs/specs/2026-09-01-agent-ts-rewrite-spec.md` §三, issue #1251).
 *
 * Idempotent by construction. Re-arming a run that IS already being executed
 * is harmless because the AgentSession lease decides — the sweep never touches
 * `runs`, it only asks a session's Durable Object to look at one again, and
 * the second look loses the lease it does not hold. That is what makes this an
 * at-least-once backstop and not a competing writer.
 */
import type { SessionWakeup } from "../session/session-wakeup.ts";

/** One `running` run a sweep may re-arm, addressed by its own session. */
export interface SweepableRun {
  readonly runId: string;
  readonly sessionId: string;
}

/**
 * The read side of the sweep: `running` runs whose lease is either expired or
 * was never taken at all, which `idx_runs_sweep` answers directly. The clock
 * is a parameter rather than SQL `now()` so a test drives the boundary.
 */
export interface RunLeases {
  withoutLiveLease(nowMs: number): Promise<SweepableRun[]>;
}

/** Re-arm every run nobody holds a live lease on; answers how many it armed. */
export async function sweepRuns(
  leases: RunLeases,
  wakeup: SessionWakeup,
  nowMs: number,
): Promise<number> {
  const stranded = await leases.withoutLiveLease(nowMs);
  for (const run of stranded) await wakeup.arm(run.sessionId, run.runId);
  return stranded.length;
}

/** The sweep cadence when a deployment configures none (spec §三: periodic). */
export const DEFAULT_SWEEP_INTERVAL_SECONDS = 60;

/**
 * The cadence one deployment configures, in milliseconds. A wrangler var is
 * always a string, and a missing or nonsense one falls back to the default
 * rather than disabling the backstop — an alarm scheduled zero or NaN
 * milliseconds out is not a faster sweep, it is no sweep at all.
 */
export function sweepIntervalMs(configured: unknown): number {
  const seconds = typeof configured === "string" ? Number(configured) : Number.NaN;
  const valid = Number.isFinite(seconds) && seconds > 0;
  return (valid ? seconds : DEFAULT_SWEEP_INTERVAL_SECONDS) * 1_000;
}
