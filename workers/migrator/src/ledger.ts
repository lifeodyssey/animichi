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

/** One row of Atlas's `public.atlas_schema_revisions` ledger. */
export interface AtlasRevisionRow {
  readonly version: unknown;
  readonly description: unknown;
}

/** Newest revisions row for a transient migrator DSN. */
export type LatestAtlasRevision = (dsn: string) => Promise<AtlasRevisionRow | undefined>;

/**
 * Neon HTTP-backed ledger reader. `readAppliedHead` opens a transient
 * connection against the migrator DSN purely to read the ledger, matching the
 * "non-resident" rule: the DSN is not retained in any standing environment.
 */
export class NeonMigrationsLedger implements MigrationsLedger {
  constructor(private readonly latestRevision: LatestAtlasRevision = selectLatestRevision) {}

  async readAppliedHead(dsn: string): Promise<string | null> {
    return basenameOf(await this.latestRevision(dsn));
  }
}

async function selectLatestRevision(dsn: string): Promise<AtlasRevisionRow | undefined> {
  const sql = neon(dsn);
  // #1087: Atlas v0.30 revisions have no `id` column — `version` is the PK.
  // Atlas splits the file basename at the first `_` into version + description.
  const rows = await sql`SELECT version, description FROM public.atlas_schema_revisions ORDER BY version DESC LIMIT 1`;
  const row = rows[0];
  if (row === undefined) return undefined;
  return { version: row.version, description: row.description };
}

function basenameOf(row: AtlasRevisionRow | undefined): string | null {
  if (row === undefined || typeof row.version !== "string" || row.version.length === 0) {
    return null;
  }
  if (typeof row.description !== "string" || row.description.length === 0) {
    return row.version;
  }
  return `${row.version}_${row.description}`;
}
