/**
 * Atomic staging Catalog switch for the snapshot import (issue #1016, AC4).
 *
 * The default ImportActivation deletes every row from the six public catalog
 * tables and inserts the validated candidate rows in ONE transaction on the
 * request's runtime — the repository's atomic unit since #1630, where the
 * neon-http batch used to be. An invalid import never reaches here (zero
 * activation), and a valid import atomically replaces staging's active Catalog.
 * The import-run marker is recorded in catalog_runs (reused table; no new
 * migration) inside that same transaction, so the whole switch is
 * all-or-nothing.
 *
 * Every statement is a builder plan. What the plans load is the snapshot's own
 * rows read as this plane's columns — `./snapshot-rows`, which owns that
 * pairing and the two places the exported shape and the table's differ.
 */
import type { SqlOrmPlan } from "@prisma/orm-postgres/relational-core/types";
import type { CatalogPrisma } from "../db/prisma";
import { atServerNow, upsert } from "../db/plans";
import { asJsonValue } from "../lib/json";
import { TABLE_BY_KIND, tableRows } from "./snapshot-rows";
import { type ImportCandidate, type ImportKind } from "./import-snapshot";

/** The atomic-switch seam the import orchestrator calls (AC4). */
export interface ImportActivation {
  switchCatalog(query: CatalogPrisma, candidate: ImportCandidate): Promise<void>;
}

/** The production adapter: clear the public catalog and load the candidate in one transaction. */
export const neonImportActivation: ImportActivation = {
  switchCatalog: (query, candidate) => importTransaction(query, candidate),
};

/** Atomic replace: clear every public table, load the candidate, record the run. */
export async function importTransaction(
  query: CatalogPrisma, candidate: ImportCandidate,
): Promise<void> {
  await query.transaction(async (tx) => {
    for (const plan of switchPlans(tx, candidate)) await tx.executor.query(plan);
  });
}

/** Every switch statement in mandatory order: the record first, then per-kind pairs. */
function switchPlans(query: CatalogPrisma, candidate: ImportCandidate): SqlOrmPlan[] {
  // Delete children before parents, insert parents before children, so the
  // one-transaction FK-safe switch holds with real rows in staging (card 1049 —
  // the prior works-first delete order violated points_refs_bangumi on re-import).
  return [
    recordImportPlan(query, candidate),
    ...DELETE_ORDER.map((kind) => clearTable(query, kind)),
    ...loadPlans(query, candidate),
  ];
}

/** Delete order: child tables before the parents that reference them. */
const DELETE_ORDER: readonly ImportKind[] = [
  "media", "provenance", "series", "aliases", "points", "works",
];

/** Insert order: parent tables before the tables that reference them. */
const INSERT_ORDER: readonly ImportKind[] = [
  "works", "points", "aliases", "series", "provenance", "media",
];

/** One INSERT per kind the candidate actually carries rows for. */
function loadPlans(query: CatalogPrisma, candidate: ImportCandidate): SqlOrmPlan[] {
  const plans: SqlOrmPlan[] = [];
  for (const kind of INSERT_ORDER) {
    const object = candidate.objects.find((o) => o.kind === kind);
    if (object !== undefined && object.rows.length > 0) plans.push(loadTable(query, kind, object.rows));
  }
  return plans;
}

/** DELETE all rows from one public catalog table — no predicate is the point. */
function clearTable(query: CatalogPrisma, kind: ImportKind): SqlOrmPlan {
  return query.builder.public[TABLE_BY_KIND[kind]].delete().build();
}

/**
 * INSERT a validated row set into one public catalog table.
 *
 * The table is chosen at run time from the kind, so the builder's INSERT is the
 * union of all six and its row type widens to what they have in common — this
 * one call site does NOT get the per-column check a named table's insert gets.
 * What covers it instead is the round trip: `import-integration` exports,
 * imports, and reads the values back, and a mapper that drops or renames a
 * column fails there rather than in the type system.
 */
function loadTable(query: CatalogPrisma, kind: ImportKind, rows: readonly unknown[]): SqlOrmPlan {
  return query.builder.public[TABLE_BY_KIND[kind]].insert(tableRows(kind, rows)).build();
}

/** INSERT (or re-mark) the staging import run so the environment has observable state. */
function recordImportPlan(query: CatalogPrisma, candidate: ImportCandidate): SqlOrmPlan {
  const insert = query.builder.public.catalog_runs
    .insert([{
      run_id: importRunId(candidate.snapshotId),
      status: "complete",
      source_outcomes: asJsonValue({ imports: [candidate.snapshotId] }),
      published_versions: asJsonValue({ snapshot: candidate.snapshotId }),
    }])
    .build();
  return upsert(atServerNow(insert, ["finished_at"]), {
    target: ["run_id"],
    update: ["status", "published_versions", "finished_at"],
  });
}

/** A stable, idempotent staging import run id derived from the snapshot id. */
export function importRunId(snapshotId: string): string {
  return "import-" + snapshotId;
}
