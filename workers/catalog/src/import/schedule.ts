/**
 * Schedule guard + staging import job for per-environment crons (#1016, AC1).
 *
 * The catalog Worker now declares DIFFERENT crons per environment in
 * wrangler.toml (upstream ingest in production, import in staging, pending
 * drain in both). This guard is the fail-closed defence-in-depth layer: a
 * staging environment that somehow receives another ingest cron no-ops it, and
 * any environment receiving the import cron without an import source binding
 * no-ops (never activates). Cron classification is a pure function so both the
 * wrangler triggers and the runtime handler share one source of truth.
 */
import { DAILY_DISCOVER_CRON, DAILY_IMPORT_CRON, PENDING_DRAIN_CRON, SEED_CRON, TTL_REFRESH_CRON } from "../cron-config";
import { allowsImportCron, allowsIngestCron, allowsPendingDrainCron, type RuntimeEnvironment } from "../operational-config";
import type { CatalogDb } from "../db/client";
import { importSnapshot, type ImportResult } from "./import-snapshot";
import type { SnapshotSource } from "./snapshot-source";

/** The kinds of cron the catalog may receive (per-env schedules, AC1). */
export type CronKind = "seed" | "ttl" | "pendingDrain" | "dailyDiscover" | "dailyImport" | "unknown";

/** Classify a cron string into a kind; unknown crons are a config error. */
export function cronKind(cron: string): CronKind {
  if (cron === SEED_CRON) return "seed";
  if (cron === TTL_REFRESH_CRON) return "ttl";
  if (cron === PENDING_DRAIN_CRON) return "pendingDrain";
  if (cron === DAILY_DISCOVER_CRON) return "dailyDiscover";
  if (cron === DAILY_IMPORT_CRON) return "dailyImport";
  return "unknown";
}

/**
 * AC1 guard: production owns ingest, staging owns import, deployed runtimes
 * may drain pending intent. A mismatch is a fail-closed no-op.
 */
export function guardCron(
  kind: CronKind,
  environment: RuntimeEnvironment,
): { denied: boolean; reason?: string } {
  switch (kind) {
    case "seed":
    case "ttl":
    case "dailyDiscover":
      return allowsIngestCron(environment)
        ? { denied: false }
        : { denied: true, reason: "ingest schedules are production-only" };
    case "dailyImport":
      return allowsImportCron(environment)
        ? { denied: false }
        : { denied: true, reason: "the import schedule is staging-only" };
    case "pendingDrain":
      return allowsPendingDrainCron(environment)
        ? { denied: false }
        : { denied: true, reason: "the pending drain requires a deployed environment" };
    case "unknown":
      return { denied: true, reason: "unknown cron kind" };
  }
}

/**
 * Run the daily staging import. With no import source (no production binding)
 * it is a hard no-op — never activates anything (AC1/AC2 fail-closed).
 */
export async function runImportJob(
  db: CatalogDb,
  source: SnapshotSource | null,
): Promise<ImportResult> {
  if (source === null) return { status: "invalid", reason: "no snapshot import source" };
  return importSnapshot(source, db);
}
