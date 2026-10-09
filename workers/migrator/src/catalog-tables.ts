import { neon } from "@neondatabase/serverless";
import { neonDeadline } from "./neon-deadline";

/**
 * #1230 Phase 1 — the three catalog tables a promoted environment must end up
 * with. Production held zero tables while staging held these, so "the chain
 * applied" and "the catalog exists" are not the same claim and only this one
 * can be read back from the target.
 *
 * The list is compile-time: like the ledger read it sits beside, the probe
 * takes no identifier from a request body, and the statement below interpolates
 * nothing but these literals.
 */
export const REQUIRED_CATALOG_TABLES = ["bangumi", "points", "ingest_jobs"] as const;

/**
 * `r` is an ordinary table and `p` a partitioned one; both satisfy "this table
 * exists". A view, materialized view or foreign table of the same name does
 * not — a promotion that left one of those behind has not delivered the table.
 */
const TABLE_KINDS = "('r', 'p')";

/** Exported so tests assert the exact statement that reached the database. */
export const MISSING_CATALOG_TABLES_SQL = `SELECT expected.name
  FROM (VALUES ${REQUIRED_CATALOG_TABLES.map((table) => `('${table}')`).join(", ")}) AS expected(name)
 WHERE NOT EXISTS (
   SELECT 1 FROM pg_catalog.pg_class relation
     JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public' AND relation.relname = expected.name
      AND relation.relkind IN ${TABLE_KINDS})`;

function nameOf(row: unknown): string | undefined {
  if (typeof row !== "object" || row === null || !("name" in row)) return undefined;
  const name = row.name;
  return typeof name === "string" ? name : undefined;
}

/**
 * A result the driver cannot be read means the probe did NOT observe the
 * schema; throwing sends the route to its fail-closed answer instead of
 * reporting a database as complete because its answer was unreadable.
 */
function missingNames(rows: unknown): readonly string[] {
  if (!Array.isArray(rows)) throw new Error("unexpected catalog probe result");
  const names = rows.map(nameOf);
  if (names.some((name) => name === undefined)) throw new Error("unexpected catalog probe result");
  return names.filter((name) => name !== undefined);
}

/**
 * The required tables this database does not have, in one read-only
 * repeatable-read transaction — the mode `preflight-ledger.ts` uses, so a probe
 * racing a promotion cannot block or be split by it.
 */
export async function readMissingCatalogTables(dsn: string): Promise<readonly string[]> {
  const sql = neon(dsn);
  const [rows]: unknown[] = await sql.transaction((txn) => [txn.query(MISSING_CATALOG_TABLES_SQL)], {
    readOnly: true,
    isolationLevel: "RepeatableRead",
    ...neonDeadline(),
  });
  return missingNames(rows);
}
