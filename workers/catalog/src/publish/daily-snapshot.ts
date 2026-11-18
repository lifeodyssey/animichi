/**
 * Daily immutable-snapshot publish after a successful catalog run (issue #1012, AC3).
 *
 * publishAfterRun runs the daily ingest, then — and only when the run finished
 * complete AND a snapshot store is present — publishes the day's immutable
 * snapshot (export -> stage -> validate -> activate) before scheduling the
 * N / N-1 reachability GC. The runId and createdAt are taken from the completed
 * run's own outcome (never recomputed from the wall clock), so the snapshot id
 * matches the run that produced it. A partial or failed run never publishes
 * (AC6), and a publish that does not activate logs its run id, status and
 * reason and schedules no GC. The ingest, publish, and gc steps are injected so
 * the gate is worker-testable.
 *
 * Each port closes over its own seam rather than receiving one: the run and the
 * snapshot publish are both Prisma plans over the pass's runtime (#1630), so a
 * port that took a database handle would have to name a seam the pass does not
 * have.
 */
import type { RunStatus } from "../ingest/daily-run";
import type { ObjectStore } from "./object-store";
import type { PublishResult } from "./snapshot";
import type { GcResult } from "./snapshot-gc";

/** The completed daily run's identity + status, threaded into the snapshot publish. */
export interface DailyRunOutcome {
  status: RunStatus;
  runId: string;
  createdAt: string;
}

/** The injectable daily publish collaborators: the daily discover pass's dependencies, each closed over its seam. */
export interface DailyPublishPorts {
  runDailyIngest: () => Promise<DailyRunOutcome>;
  publishRun: (store: ObjectStore, sourceRunId: string, createdAt: string) => Promise<PublishResult>;
  gcSnapshots: (store: ObjectStore) => Promise<GcResult>;
}

/** Publish + GC the day's snapshot, gated to a fully successful run. */
export async function publishAfterRun(
  store: ObjectStore | null,
  ports: DailyPublishPorts,
): Promise<void> {
  const outcome = await ports.runDailyIngest();
  if (store === null || outcome.status !== "complete") return;
  const result = await ports.publishRun(store, outcome.runId, outcome.createdAt);
  if (result.status !== "published") {
    logNotActivated(outcome.runId, result);
    return;
  }
  await ports.gcSnapshots(store);
}

/** A publish that did not activate says why: its run, its status and its reason, nothing more. */
function logNotActivated(runId: string, result: Exclude<PublishResult, { status: "published" }>): void {
  console.error(`[dailyPublish] run ${runId} not activated (${result.status}): ${result.reason}`);
}
