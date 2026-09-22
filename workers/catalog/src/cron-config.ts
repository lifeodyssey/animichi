/**
 * Scheduled-ingestion configuration (S0-v2 D4 + #1016 per-env schedules).
 *
 * Lives in its own module, NOT as exports of the Worker entry (`src/index.ts`):
 * workerd rejects primitive named exports from the entry module at boot
 * ("Incorrect type for map entry 'SEED_CRON'"), so scheduling constants are
 * imported here and re-exported from nowhere. Keep the strings in sync with
 * the `[triggers]` cron lists in wrangler.toml.
 *
 * Production owns upstream ingest and staging owns snapshot import. Issue
 * #1229 adds a separate durable-intent drain allowed in both deployed
 * environments; ENVIRONMENT guards still fail closed on wrong routing.
 */

/** Daily seed pass — pre-populate the catalog from the checked-in work list. */
export const SEED_CRON = "0 4 * * *";
/** Hourly TTL refresh — re-ingest the stalest raw works, capped per run. */
export const TTL_REFRESH_CRON = "17 * * * *";
/** TTL refresh batch cap — one run never ingests more works than this. */
export const TTL_BATCH_CAP = 5;

/** Hourly staging drain — execute request-parked ingest outside request scope. */
export const PENDING_DRAIN_CRON = "37 * * * *";
export const PENDING_DRAIN_BATCH_CAP = 5;

/** Daily discovery + ingest — one durable production run per UTC day. */
export const DAILY_DISCOVER_CRON = "0 6 * * *";

/**
 * Daily run work cap — one run never ingests more works than this.
 *
 * It is a cap like the hourly ones because it spends the SAME hour they do: the
 * daily run fires at 06:00, the TTL refresh at :17 and the staged drain at :37,
 * and the upstream ceiling (100 requests per clock hour, `apps/anitabi-egress`)
 * counts REQUESTS — up to one per operation per work. So the caps of every
 * caller that can land in one hour are one pool, and
 * `test/repo-config/anitabi-egress-ceiling.test.rb` converts and refuses a
 * raise past the ceiling; this value is what that arithmetic leaves the daily
 * run (#1809).
 */
export const DAILY_WORK_CAP = 40;

/** Daily staging snapshot import (#1016). */
export const DAILY_IMPORT_CRON = "0 3 * * *";
