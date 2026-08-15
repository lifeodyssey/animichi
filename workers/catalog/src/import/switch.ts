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
import { getTableColumns, type SQL } from "drizzle-orm";
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
import { type ImportCandidate, type ImportKind } from "./import-snapshot";

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
  // Delete children before parents, insert parents before children, so the
  // one-batch FK-safe switch holds with real rows in staging (card 1049 — the
  // prior works-first delete order violated points_refs_bangumi on re-import).
  for (const kind of DELETE_ORDER) {
    middle.push(deleteTable(TABLE_BY_KIND[kind]));
  }
  for (const kind of INSERT_ORDER) {
    const object = candidate.objects.find((o) => o.kind === kind);
    if (object !== undefined && object.rows.length > 0) {
      middle.push(insertRows(TABLE_BY_KIND[kind], object.rows));
    }
  }
  return [recordImportStatement(candidate), ...middle];
}

/** Delete order: child tables before the parents that reference them. */
const DELETE_ORDER: readonly ImportKind[] = [
  "media", "provenance", "series", "aliases", "points", "works",
];

/** Insert order: parent tables before the tables that reference them. */
const INSERT_ORDER: readonly ImportKind[] = [
  "works", "points", "aliases", "series", "provenance", "media",
];

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
  if (!isRecord(row)) return row as InsertValueFor<typeof table>;
  // The export serializes rows under their DB column names; Drizzle insert keys
  // are the TS column names, so remap (e.g. entity_id -> entityId) before insert
  // (card 1049: provenance/points were imported with nulled columns otherwise).
  const byDbName = new Map<string, string>();
  const timestampKeys = new Set<string>();
  const cols = getTableColumns(table) as Record<string, { name: string; columnType: string }>;
  for (const [tsKey, column] of Object.entries(cols)) {
    byDbName.set(column.name, tsKey);
    if (column.columnType === "PgTimestamp" || column.columnType === "PgTimestampWithTimezone") timestampKeys.add(tsKey);
  }
  const remapped: Record<string, unknown> = {};
  for (const key of Object.keys(row)) {
    const target = byDbName.get(key) ?? key;
    // The export serializes timestamps to ISO strings; restore them to Date so
    // Drizzle's timestamp mapper can encode them (card 1049).
    const raw = row[key];
    remapped[target] = timestampKeys.has(target) && typeof raw === "string" ? new Date(raw) : raw;
  }
  return remapped;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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
