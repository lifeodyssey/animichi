import { neon } from "@neondatabase/serverless";

/**
 * #1051 — Atlas revisions ledger reader.
 *
 * Reads the applied head from `public.atlas_schema_revisions` (the ledger
 * Atlas maintains under `--revisions-schema public`). The migrator worker
 * uses this READ-ONLY query after the batch container exits cleanly so the
 * trigger contract can carry the real applied head — CI fails unless it equals
 * the expected head it sent (spec §"Trigger contract"). This is the migrator's
 * only database capability alongside "apply the committed chain"; it performs
 * no mutation.
 */

export interface MigrationsLedger {
  readAppliedHead(dsn: string): Promise<string | null>;
}

/**
 * Neon HTTP-backed ledger reader. `readAppliedHead` opens a transient
 * connection against the migrator DSN purely to read the ledger, matching the
 * "non-resident" rule: the DSN is not retained in any standing environment.
 */
export class NeonMigrationsLedger implements MigrationsLedger {
  async readAppliedHead(dsn: string): Promise<string | null> {
    const sql = neon(dsn);
    // #1087: the Atlas v0.30 revisions table has NO id column — its primary
    // key is `version` (timestamped, append-only migration basenames), so
    // version DESC is the newest applied head and matches scripts/migration-head.sh.
    // ORDER BY id would fail at runtime (column id does not exist).
    const rows = await sql`SELECT version FROM public.atlas_schema_revisions ORDER BY version DESC LIMIT 1`;
    const row = rows[0];
    return row !== undefined && typeof row.version === "string" ? row.version : null;
  }
}