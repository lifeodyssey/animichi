/**
 * Catalog operational configuration (production-readiness spec §§183/314).
 *
 * These are OPERATIONAL DEFAULTS, not magic numbers: the schedule division
 * (production ingest, staging import, deployed pending drain), the frequency, and the
 * staleness thresholds live here so a change is a documented operations edit
 * rather than a bare literal scattered through source. Per spec §314 the
 * initial values are: daily production ingest, daily staging import,
 * production stale after 36 hours, staging stale after 48 hours. Changing
 * them requires measured evidence + an operations-document update.
 */
import {
  DAILY_DISCOVER_CRON,
  DAILY_IMPORT_CRON,
  PENDING_DRAIN_BATCH_CAP,
  SEED_CRON,
  TTL_BATCH_CAP,
  TTL_REFRESH_CRON,
} from "./cron-config";
import type { BudgetLimits } from "./ingest/budgets";
import type { RunPolicy } from "./ingest/daily-run";

/** The runtime environments the catalog Worker can run in. */
export type RuntimeEnvironment = "development" | "staging" | "production";

/** Parse the ENVIRONMENT var, failing closed to non-prod on any malformed value. */
export function runtimeEnvironment(value: string | undefined): RuntimeEnvironment {
  switch (value) {
    case "production":
    case "staging":
      return value;
    default:
      return "development";
  }
}

/** Production alone may schedule upstream Catalog ingest (§183). */
export const PRODUCTION_INGEST_CRONS: readonly string[] = [
  SEED_CRON,
  DAILY_DISCOVER_CRON,
  TTL_REFRESH_CRON,
];

/** Staging's daily snapshot import schedule (§183). */
export const STAGING_IMPORT_CRON = DAILY_IMPORT_CRON;

/** The daily production ingest schedule (§314) — the discovery cron string. */
export const DAILY_PRODUCTION_INGEST = DAILY_DISCOVER_CRON;

/** Production ingest source snapshot is stale after 36 hours (§314). */
export const PRODUCTION_STALE_SECONDS = 36 * 60 * 60;

/** Staging imported snapshot is stale after 48 hours (§314). */
export const STAGING_STALE_SECONDS = 48 * 60 * 60;

/** Whether an ingest cron may run in the given environment (fail-closed). */
export function allowsIngestCron(environment: RuntimeEnvironment): boolean {
  return environment === "production";
}

/** Whether the daily import cron may run in the given environment. */
export function allowsImportCron(environment: RuntimeEnvironment): boolean {
  return environment === "staging";
}

/** Both deployed environments may drain durable request intent. */
export function allowsPendingDrainCron(environment: RuntimeEnvironment): boolean {
  return environment === "staging" || environment === "production";
}

/** One hourly event shares a bounded allowance across pending and TTL work. */
export function hourlyIngestBudget(): BudgetLimits {
  const workLimit = PENDING_DRAIN_BATCH_CAP + TTL_BATCH_CAP;
  return { workLimit, requestLimit: workLimit * 2, runtimeLimitMs: 14 * 60 * 1000 };
}

/** Production budget/tier policy for the daily run (operational config, not magic). */
export function dailyPolicy(): RunPolicy {
  return {
    staleRunningMs: 6 * 60 * 60 * 1000,
    tierIntervals: { high: 24 * 60 * 60 * 1000, medium: 7 * 24 * 60 * 60 * 1000, low: 30 * 24 * 60 * 60 * 1000 },
    newWorkCap: 20,
    keepHistory: 2,
    budget: { workLimit: 50, requestLimit: 400, runtimeLimitMs: 10 * 60 * 1000 },
  };
}
