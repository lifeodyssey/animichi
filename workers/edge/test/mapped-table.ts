/**
 * The table shape a Drizzle mapping declares, reduced to the same facts
 * `migration-schema.ts` reads out of the Atlas SQL so the two can be compared
 * directly. Reads Drizzle's own `getTableConfig`, never a transcription.
 */

import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";

/** One mapped column: its nullability, whether a default fills it, its domain. */
export interface MappedColumn {
  readonly notNull: boolean;
  readonly hasDefault: boolean;
  /** The values an `enum` column option admits; empty for an open domain. */
  readonly values: readonly string[];
}

/** One mapped table's columns, primary key, and the unique keys it declares. */
export interface MappedTable {
  readonly columns: Map<string, MappedColumn>;
  readonly primaryKey: readonly string[];
  readonly uniqueKeys: Map<string, readonly string[]>;
}

type TableConfig = ReturnType<typeof getTableConfig>;
type UniqueKey = readonly [string, readonly string[]];

/** An index entry names a column or is a bare SQL expression; keep the named ones. */
function columnName(entry: object): string[] {
  return "name" in entry && typeof entry.name === "string" ? [entry.name] : [];
}

function uniqueIndexKeys(config: TableConfig): UniqueKey[] {
  return config.indexes.flatMap((one): UniqueKey[] =>
    one.config.unique && typeof one.config.name === "string"
      ? [[one.config.name, one.config.columns.flatMap(columnName)]]
      : [],
  );
}

/** A single-column `.primaryKey()` lives on the column; a composite one on the table. */
function primaryKeyColumns(config: TableConfig): string[] {
  const composite = config.primaryKeys.flatMap((one) => one.columns.flatMap(columnName));
  const single = config.columns.filter((one) => one.primary).map((one) => one.name);
  return composite.length > 0 ? composite : single;
}

function constraintKeys(config: TableConfig): UniqueKey[] {
  return config.uniqueConstraints.flatMap((one): UniqueKey[] =>
    typeof one.name === "string" ? [[one.name, one.columns.flatMap(columnName)]] : [],
  );
}

/** Every column and unique key the Drizzle mapping of *table* declares. */
export function readMappedTable(table: PgTable): MappedTable {
  const config = getTableConfig(table);
  const columns = config.columns.map((column): [string, MappedColumn] => [
    column.name,
    { notNull: column.notNull, hasDefault: column.hasDefault, values: column.enumValues ?? [] },
  ]);
  return {
    columns: new Map(columns),
    primaryKey: primaryKeyColumns(config),
    uniqueKeys: new Map([...constraintKeys(config), ...uniqueIndexKeys(config)]),
  };
}
