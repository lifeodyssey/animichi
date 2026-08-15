/**
 * Scheduled-ingestion configuration (S0-v2 D4 + #1016 per-env schedules).
 *
 * Lives in its own module, NOT as exports of the Worker entry (`src/index.ts`):
 * workerd rejects primitive named exports from the entry module at boot
 * ("Incorrect type for map entry 'SEED_CRON'"), so scheduling constants are
 * imported here and re-exported from nowhere. Keep the strings in sync with
 * the `[triggers]` cron lists in wrangler.toml.
 *
 * Per issue #1016 / spec §183 the ingest schedules belong to PRODUCTION alone
 * and the daily import schedule belongs to STAGING; wrangler.toml assigns each
 * cron to the environment that may run it, and the scheduled handler guards on
 * the runtime ENVIRONMENT var so a wrongly-routed event fails closed.
 */

/** Daily seed pass — pre-populate the catalog from the checked-in work list. */
export const SEED_CRON = "0 4 * * *";
/** Hourly TTL refresh — re-ingest the stalest raw works, capped per run. */
export const TTL_REFRESH_CRON = "17 * * * *";
/** TTL refresh batch cap — one run never ingests more works than this. */
export const TTL_BATCH_CAP = 5;

/** Daily discovery + ingest — one durable production run per UTC day. */
export const DAILY_DISCOVER_CRON = "0 6 * * *";

/** Daily staging snapshot import — the only automatic staging schedule (#1016). */
export const DAILY_IMPORT_CRON = "0 3 * * *";
