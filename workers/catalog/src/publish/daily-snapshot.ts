/**
 * Daily immutable-snapshot publish after a successful catalog run (issue #1012, AC3).
 *
 * publishAfterRun runs the daily ingest, then — and only when the run finished
 * complete AND a snapshot store is present — publishes the day's immutable
 * snapshot (export -> stage -> validate -> activate) before scheduling the
 * N / N-1 reachability GC. The runId and createdAt are taken from the completed
 * run's own outcome (never recomputed from the wall clock), so the snapshot id
 * matches the run that produced it. A partial or failed run never publishes
 * (AC6). The ingest, publish, and gc steps are injected so the gate is
 * worker-testable.
 */
import type { CatalogDb } from "../db/client";
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

/** The injectable daily publish collaborators (subset of CronDependencies). */
export interface DailyPublishPorts {
  runDailyIngest: (db: CatalogDb, store: ObjectStore | null) => Promise<DailyRunOutcome>;
  publishRun: (db: CatalogDb, store: ObjectStore, sourceRunId: string, createdAt: string) => Promise<PublishResult>;
  gcSnapshots: (store: ObjectStore) => Promise<GcResult>;
}

/** Publish + GC the day's snapshot, gated to a fully successful run. */
export async function publishAfterRun(
  db: CatalogDb,
  store: ObjectStore | null,
  ports: DailyPublishPorts,
): Promise<void> {
  const outcome = await ports.runDailyIngest(db, store);
  if (store === null || outcome.status !== "complete") return;
  const result = await ports.publishRun(db, store, outcome.runId, outcome.createdAt);
  if (result.status === "published") await ports.gcSnapshots(store);
}
