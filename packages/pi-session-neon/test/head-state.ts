import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DATA_PLANE_ACCESS } from "../migrations/app/20260913T1711_data_plane_baseline/access.ts";

/** What the chain's head builds: the baseline's declarations, less every table a later migration
 * drops. The dropped tables are read from the emitted operations, so a drop moves the head
 * without a test restating it, and the baseline stays the one place a table is declared. */

const migrationRoot = fileURLToPath(new URL("../migrations/app/", import.meta.url));
const BASELINE = "20260913T1711_data_plane_baseline";

type PostcheckStep = (typeof DATA_PLANE_ACCESS.postcheck)[number];

interface EmittedOperation {
  readonly id: string;
  readonly target: { readonly details?: { readonly name?: string } };
}

function laterMigrations(): string[] {
  return readdirSync(migrationRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== BASELINE)
    .map((entry) => entry.name);
}

function droppedTable({ id, target }: EmittedOperation): string {
  const name = target.details?.name;
  if (name === undefined) throw new Error(`operation ${id} names no table`);
  return name;
}

function tablesDroppedBy(migration: string): string[] {
  const operations = JSON.parse(readFileSync(join(migrationRoot, migration, "ops.json"), "utf8")) as EmittedOperation[];
  return operations.filter(({ id }) => id.startsWith("dropTable.")).map(droppedTable);
}

/** Every table a migration after the baseline drops; empty until the first drop. */
export const DROPPED_TABLES: readonly string[] = laterMigrations().flatMap(tablesDroppedBy);

/** `tables` less the ones a later migration drops. */
export function stillBuilt(tables: readonly string[]): string[] {
  return tables.filter((table) => !DROPPED_TABLES.includes(table));
}

/** The baseline's grant postcheck less every step about a dropped table, matched by the failure
 * text each step carries ("… explicit grants on <table> are …"). */
export const HEAD_GRANT_STEPS: readonly PostcheckStep[] = DATA_PLANE_ACCESS.postcheck
  .filter(({ description }) => !DROPPED_TABLES.some((table) => description.includes(` on ${table} are `)));
