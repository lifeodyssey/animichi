/**
 * Schedule guard + staging import job for per-environment crons (#1016, AC1).
 *
 * The catalog Worker now declares DIFFERENT crons per environment in
 * wrangler.toml (ingest schedules in production only, the daily import in
 * staging only). This guard is the fail-closed defence-in-depth layer: a
 * staging environment that somehow receives an ingest cron event no-ops it, and
 * any environment receiving the import cron without an import source binding
 * no-ops (never activates). Cron classification is a pure function so both the
 * wrangler triggers and the runtime handler share one source of truth.
 */
import { DAILY_DISCOVER_CRON, DAILY_IMPORT_CRON, SEED_CRON, TTL_REFRESH_CRON } from "../cron-config";
import { allowsImportCron, allowsIngestCron, type RuntimeEnvironment } from "../operational-config";
import type { CatalogDb } from "../db/client";
import { importSnapshot, type ImportResult } from "./import-snapshot";
import type { SnapshotSource } from "./snapshot-source";

/** The kinds of cron the catalog may receive (per-env schedules, AC1). */
export type CronKind = "seed" | "ttl" | "dailyDiscover" | "dailyImport" | "unknown";

/** Classify a cron string into a kind; unknown crons are a config error. */
export function cronKind(cron: string): CronKind {
  if (cron === SEED_CRON) return "seed";
  if (cron === TTL_REFRESH_CRON) return "ttl";
  if (cron === DAILY_DISCOVER_CRON) return "dailyDiscover";
  if (cron === DAILY_IMPORT_CRON) return "dailyImport";
  return "unknown";
}

/**
 * AC1 guard: ingest crons run only in production; the import cron only in
 * staging. A mismatch is a no-op (fail-closed), never a silent wrong job.
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
    case "unknown":
      return { denied: false };
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
