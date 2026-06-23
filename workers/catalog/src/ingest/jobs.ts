/**
 * Singleflight job tracking over the `ingest_jobs` table
 * (`supabase/migrations/20260620230000_ingest_infrastructure.sql`):
 *   work_id (PK), status, stage, error, error_code, negative_cached_until.
 *
 * One ingest per work_id runs at a time (singleflight). `acquire` is the gate:
 * a single `INSERT ... ON CONFLICT DO UPDATE ... WHERE` atomically picks exactly
 * one winner under concurrency — losers (an in-flight row, or a live negative
 * cache) skip the UPDATE and see zero RETURNING rows. A recent failure parks the
 * work behind `negative_cached_until` so a hot upstream error is not retried on
 * every request; once that TTL elapses the same statement re-acquires, so a
 * failed job never gets permanently stuck.
 *
 * Writes only: the Drizzle read schema (`src/db/schema.ts`) is query-only, so
 * these mutations go through raw `sql` execute, consistent with the pipeline
 * cards owning all inserts/updates.
 */
import { sql } from "drizzle-orm";
import type { CatalogDb } from "../db/client";

/** Failure parameters for {@link JobStore.markFailed}. */
export interface FailureOptions {
  errorCode: string;
  ttlSeconds: number;
  error?: string;
}

/** Singleflight + negative-cache gate over `ingest_jobs`. */
export class JobStore {
  constructor(private readonly db: CatalogDb) {}

  /** True if this caller won the singleflight; false if running or negative-cached. */
  async acquire(workId: string): Promise<boolean> {
    const rows = await this.selectRows(sql`
      INSERT INTO ingest_jobs (work_id, status, started_at)
      VALUES (${workId}, 'running', NOW())
      ON CONFLICT (work_id) DO UPDATE
        SET status = 'running', started_at = NOW()
        WHERE ingest_jobs.status <> 'running'
          AND (ingest_jobs.negative_cached_until IS NULL
               OR ingest_jobs.negative_cached_until <= NOW())
      RETURNING work_id
    `);
    return rows.length > 0;
  }

  /** Mark the job done; clears any negative cache. */
  async markDone(workId: string): Promise<void> {
    await this.db.execute(sql`
      UPDATE ingest_jobs
      SET status = 'done', finished_at = NOW(),
          error = NULL, error_code = NULL, negative_cached_until = NULL
      WHERE work_id = ${workId}
    `);
  }

  /** Mark failed and park the work behind negative_cached_until = now()+ttl. */
  async markFailed(workId: string, opts: FailureOptions): Promise<void> {
    if (opts.ttlSeconds <= 0) throw new Error("ttlSeconds must be > 0");
    await this.db.execute(sql`
      UPDATE ingest_jobs
      SET status = 'failed', finished_at = NOW(),
          error = ${opts.error ?? null}, error_code = ${opts.errorCode},
          negative_cached_until = NOW() + make_interval(secs => ${opts.ttlSeconds})
      WHERE work_id = ${workId}
    `);
  }

  /** Run a read query and return its rows as an opaque array. */
  private async selectRows(query: ReturnType<typeof sql>): Promise<object[]> {
    return (await this.db.execute(query)).rows;
  }
}
