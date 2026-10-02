import { neon } from "@neondatabase/serverless";
import { neonDeadline } from "./neon-deadline";

/**
 * #1625 — a database still standing on the retired Atlas chain. The Prisma baseline creates
 * what that chain created, so applying onto it fails inside the apply with 42710. CD's staging
 * job rebuilds exactly this state first (`infra/database-access/reset-staging-baseline.sh`);
 * when that has not happened, the migrator refuses by this name before any DDL.
 *
 * The chain's own ledger is the signature: every database it migrated carries
 * `public.atlas_schema_revisions`, the one table nothing else creates, and the rebuild drops it.
 */
export const ATLAS_LEFTOVERS_PRESENT = "atlas_leftovers_present";

/** The ledger's name or NULL: text, not a boolean, so no driver type parser stands between the
 * database's answer and this check. */
const ATLAS_LEDGER_SQL = "SELECT to_regclass('public.atlas_schema_revisions')::text AS ledger";

/** An unreadable answer throws, so the route fails closed instead of reading it as "clean". */
function strandedOf(rows: unknown): boolean {
  const row: unknown = Array.isArray(rows) ? rows[0] : undefined;
  if (typeof row !== "object" || row === null || !("ledger" in row)) throw new Error("unexpected ledger probe result");
  if (row.ledger !== null && typeof row.ledger !== "string") throw new Error("unexpected ledger probe result");
  return row.ledger !== null;
}

/** Read-only and repeatable-read, like the catalog probe beside it. This is the call that
 * stopped answering on 2026-09-24 (#1958), so it carries its own deadline. */
export async function carriesAtlasLeftovers(dsn: string): Promise<boolean> {
  const sql = neon(dsn);
  const [rows]: unknown[] = await sql.transaction((txn) => [txn.query(ATLAS_LEDGER_SQL)], {
    readOnly: true,
    isolationLevel: "RepeatableRead",
    ...neonDeadline(),
  });
  return strandedOf(rows);
}
