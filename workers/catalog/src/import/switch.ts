/**
 * Atomic staging Catalog switch for the snapshot import (issue #1016, AC4).
 *
 * The default ImportActivation deletes every row from the six public catalog
 * tables and inserts the validated candidate rows in ONE server-side batch
 * (db.batch) — the repository's documented one-PostgreSQL-transaction primitive
 * (same as publishVersion). The import-run marker is recorded in catalog_runs
 * (reused table; no new migration) in the same batch, so the whole switch is
 * all-or-nothing: an invalid import never reaches here (zero activation), and a
 * valid import atomically replaces staging's active Catalog. Statements are
 * built with the Drizzle builder through the single CatalogDb seam.
 */
import { type SQL } from "drizzle-orm";
import type { AnyPgTable } from "drizzle-orm/pg-core";
import type { CatalogDb } from "../db/client";
import { statementBuilder } from "../db/client";
import {
  aliases,
  bangumi,
  catalogProvenance,
  catalogRuns,
  mediaAssets,
  points,
  seriesEdges,
} from "../db/schema";
import * as x from "../db/expressions";
import { IMPORT_KINDS, type ImportCandidate, type ImportKind } from "./import-snapshot";

/** The atomic-switch seam the import orchestrator calls (AC4). */
export interface ImportActivation {
  switchCatalog(db: CatalogDb, candidate: ImportCandidate): Promise<void>;
}

/** The production adapter: clear the public catalog and load the candidate in one batch. */
export const neonImportActivation: ImportActivation = {
  switchCatalog: (db, candidate) => importBatch(db, candidate),
};

/** The public table a snapshot kind maps to (staging's active Catalog). */
const TABLE_BY_KIND: Record<ImportKind, AnyPgTable> = {
  works: bangumi,
  points: points,
  aliases: aliases,
  series: seriesEdges,
  provenance: catalogProvenance,
  media: mediaAssets,
};

/** Atomic replace: clear every public table, load the candidate, record the run. */
export async function importBatch(db: CatalogDb, candidate: ImportCandidate): Promise<void> {
  await db.batch(prepareBatch(db, buildStatements(candidate)));
}

/** Every switch statement in mandatory order: the record first, then per-kind pairs. */
function buildStatements(candidate: ImportCandidate): [SQL, ...SQL[]] {
  const middle: SQL[] = [];
  for (const kind of IMPORT_KINDS) {
    middle.push(deleteTable(TABLE_BY_KIND[kind]));
    const object = candidate.objects.find((o) => o.kind === kind);
    if (object !== undefined && object.rows.length > 0) {
      middle.push(insertRows(TABLE_BY_KIND[kind], object.rows));
    }
  }
  return [recordImportStatement(candidate), ...middle];
}

/** Convert ordered SQL into lazy Drizzle batch items without executing them. */
function prepareBatch(db: CatalogDb, statements: readonly [SQL, ...SQL[]]) {
  const [first, ...rest] = statements;
  return [db.execute(first), ...rest.map((statement) => db.execute(statement))] as const;
}

/** DELETE all rows from one public catalog table. */
function deleteTable(table: AnyPgTable): SQL {
  return statementBuilder().delete(table).getSQL();
}

/** INSERT a validated row set into one public catalog table. */
function insertRows(table: AnyPgTable, rows: readonly unknown[]): SQL {
  const values = rows.map((row) => importInsertValue(table, row));
  return statementBuilder().insert(table).values(values).getSQL();
}

/** Cast a validated import row to the target table's insert value. */
function importInsertValue(table: AnyPgTable, row: unknown): InsertValueFor<typeof table> {
  return row as InsertValueFor<typeof table>;
}

/** The object shape Drizzle accepts in .values() for a table (boundary cast). */
type InsertValueFor<T> = T extends { $inferInsert: infer I } ? I : never;

/** INSERT (or re-mark) the staging import run so the environment has observable state. */
function recordImportStatement(candidate: ImportCandidate): SQL {
  return statementBuilder()
    .insert(catalogRuns)
    .values({
      runId: importRunId(candidate.snapshotId),
      status: "complete",
      sourceOutcomes: { imports: [candidate.snapshotId] },
      publishedVersions: { snapshot: candidate.snapshotId },
      finishedAt: x.now(),
    })
    .onConflictDoUpdate({
      target: catalogRuns.runId,
      set: {
        status: "complete",
        publishedVersions: { snapshot: candidate.snapshotId },
        finishedAt: x.now(),
      },
    })
    .getSQL();
}

/** A stable, idempotent staging import run id derived from the snapshot id. */
export function importRunId(snapshotId: string): string {
  return "import-" + snapshotId;
}
