/**
 * The table shapes the Atlas chain under `migrations/neon` actually declares,
 * read straight from the SQL. Tests compare a Drizzle mapping against this so
 * neither side is a hand-maintained transcription of the other.
 *
 * Deliberately narrow: it understands the statement forms this repository's
 * migrations use — `CREATE TABLE public.x (...)` with one column or constraint
 * per line, `ALTER TABLE public.x ADD COLUMN ...`, `CREATE UNIQUE INDEX ...` —
 * and nothing else. It is a reader, never a DDL authority.
 */

import { readFileSync, readdirSync } from "node:fs";

/** One column as the migration declares it. */
export interface ColumnSchema {
  readonly type: string;
  readonly notNull: boolean;
  readonly hasDefault: boolean;
}

/** One table's declared columns, keys, and CHECK value domains. */
export interface TableSchema {
  readonly columns: Map<string, ColumnSchema>;
  /** The columns of the table's PRIMARY KEY, in declaration order. */
  primaryKey: readonly string[];
  /** Constraint or index name -> the columns it makes unique. */
  readonly uniqueKeys: Map<string, readonly string[]>;
  /** CHECK constraint name -> the literals its `ARRAY[...]` admits. */
  readonly checkVocabularies: Map<string, readonly string[]>;
}

const TABLE_BODY = /CREATE TABLE public\.(\w+) \(\n([\s\S]*?)\n\);/g;
const ADDED_COLUMN = /^ALTER TABLE public\.(\w+) ADD COLUMN (\w+) (.+);$/gm;
const UNIQUE_INDEX = /CREATE UNIQUE INDEX (\w+) ON public\.(\w+) \(([^)]*)\)/g;
const UNIQUE_CONSTRAINT = /^CONSTRAINT (\w+) UNIQUE \(([^)]*)\)$/;
const PRIMARY_KEY = /^PRIMARY KEY \(([^)]*)\)$/;
const CHECK_CONSTRAINT = /^CONSTRAINT (\w+) CHECK .*?ARRAY\[([^\]]*)\]/;
const QUOTED_LITERAL = /'([^']*)'/g;

function columnNames(list: string): readonly string[] {
  return list.split(",").map((part) => part.trim().split(" ")[0] ?? "");
}

function parseColumn(declaration: string): ColumnSchema {
  const [type = ""] = declaration.split(/ NOT NULL| NULL| DEFAULT /);
  return {
    type: type.trim(),
    notNull: declaration.includes(" NOT NULL"),
    hasDefault: declaration.includes(" DEFAULT "),
  };
}

function emptyTable(): TableSchema {
  return { columns: new Map(), primaryKey: [], uniqueKeys: new Map(), checkVocabularies: new Map() };
}

function tableOf(schema: Map<string, TableSchema>, name: string): TableSchema {
  const existing = schema.get(name) ?? emptyTable();
  schema.set(name, existing);
  return existing;
}

function readConstraint(table: TableSchema, line: string): void {
  const unique = UNIQUE_CONSTRAINT.exec(line);
  if (unique?.[1] !== undefined) table.uniqueKeys.set(unique[1], columnNames(unique[2] ?? ""));
  const check = CHECK_CONSTRAINT.exec(line);
  if (check?.[1] === undefined) return;
  const literals = [...(check[2] ?? "").matchAll(QUOTED_LITERAL)].map((match) => match[1] ?? "");
  table.checkVocabularies.set(check[1], literals);
}

function readBodyLine(table: TableSchema, raw: string): void {
  const line = raw.trim().replace(/,$/, "");
  const key = PRIMARY_KEY.exec(line);
  if (key !== null) {
    table.primaryKey = columnNames(key[1] ?? "");
    return;
  }
  if (line.startsWith("CONSTRAINT ")) {
    readConstraint(table, line);
    return;
  }
  const [name = "", ...rest] = line.split(" ");
  table.columns.set(name, parseColumn(rest.join(" ")));
}

function readCreatedTables(schema: Map<string, TableSchema>, chain: string): void {
  for (const [, name = "", body = ""] of chain.matchAll(TABLE_BODY)) {
    const table = tableOf(schema, name);
    for (const line of body.split("\n")) readBodyLine(table, line);
  }
}

function readAddedColumns(schema: Map<string, TableSchema>, chain: string): void {
  for (const [, name = "", column = "", declaration = ""] of chain.matchAll(ADDED_COLUMN)) {
    tableOf(schema, name).columns.set(column, parseColumn(declaration));
  }
}

function readUniqueIndexes(schema: Map<string, TableSchema>, chain: string): void {
  for (const [, index = "", name = "", list = ""] of chain.matchAll(UNIQUE_INDEX)) {
    tableOf(schema, name).uniqueKeys.set(index, columnNames(list));
  }
}

/** Every table the migration directory declares, keyed by table name. */
export function readMigrationSchema(directory: string): Map<string, TableSchema> {
  const files = readdirSync(directory).filter((file) => file.endsWith(".sql")).sort();
  const chain = files.map((file) => readFileSync(`${directory}/${file}`, "utf8")).join("\n");
  const schema = new Map<string, TableSchema>();
  readCreatedTables(schema, chain);
  readAddedColumns(schema, chain);
  readUniqueIndexes(schema, chain);
  return schema;
}
