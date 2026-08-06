/**
 * Scheduled-ingestion configuration (S0-v2 D4).
 *
 * Lives in its own module, NOT as exports of the Worker entry (`src/index.ts`):
 * workerd rejects primitive named exports from the entry module at boot
 * ("Incorrect type for map entry 'SEED_CRON'"), so scheduling constants are
 * imported here and re-exported from nowhere. Keep the strings in sync with
 * the `[triggers]` cron lists in wrangler.toml.
 */

/** Daily seed pass — pre-populate the catalog from the checked-in work list. */
export const SEED_CRON = "0 4 * * *";
/** Hourly TTL refresh — re-ingest the stalest raw works, capped per run. */
export const TTL_REFRESH_CRON = "17 * * * *";
/** TTL refresh batch cap — one run never ingests more works than this. */
export const TTL_BATCH_CAP = 5;
