/**
 * Daily immutable-snapshot publish after a successful catalog run (issue #1012, AC3).
 *
 * publishAfterRun runs the daily ingest, then — and only when the run finished
 * complete AND a snapshot store is present — publishes the day's immutable
 * snapshot (export -> stage -> validate -> activate) before scheduling the
 * N / N-1 reachability GC. A partial or failed run never publishes (AC6). The
 * ingest, publish, and gc steps are injected so the gate is worker-testable.
 */
import type { CatalogDb } from "../db/client";
import type { RunStatus } from "../ingest/daily-run";
import { dailyRunKey } from "../ingest/daily-discovery";
import type { ObjectStore } from "./object-store";
import type { PublishResult } from "./snapshot";
import type { GcResult } from "./snapshot-gc";

/** The injectable daily publish collaborators (subset of CronDependencies). */
export interface DailyPublishPorts {
  runDailyIngest: (db: CatalogDb, store: ObjectStore | null) => Promise<RunStatus>;
  publishRun: (db: CatalogDb, store: ObjectStore, sourceRunId: string, createdAt: string) => Promise<PublishResult>;
  gcSnapshots: (store: ObjectStore) => Promise<GcResult>;
}

/** Publish + GC the day's snapshot, gated to a fully successful run. */
export async function publishAfterRun(
  db: CatalogDb,
  store: ObjectStore | null,
  ports: DailyPublishPorts,
): Promise<void> {
  const status = await ports.runDailyIngest(db, store);
  if (store === null || status !== "complete") return;
  const runId = dailyRunKey(Date.now());
  const result = await ports.publishRun(db, store, runId, new Date().toISOString());
  if (result.status === "published") await ports.gcSnapshots(store);
}
