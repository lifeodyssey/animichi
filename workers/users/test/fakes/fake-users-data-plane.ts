/**
 * The in-memory data plane the users Prisma double executes against (#1632).
 *
 * It holds two tables, reads each plan's AST, evaluates the WHERE tree against
 * the rows it holds, applies the write and projects the `returning(...)` list.
 * That is what makes `rowCount`, "exactly one statement" and "scoped to the
 * owning user" assertions still mean something now that no SQL text exists to
 * capture — and it is strictly more honest than the old fake, which matched
 * rendered SQL by substring.
 *
 * What it refuses to model, it refuses loudly: a computed projection, an
 * operator it does not know, or an INSERT that supplies `saved_routes.id` throws
 * instead of quietly answering. A predicate the fake silently skipped would make
 * every scoping assertion in the suite pass for free.
 */
import type { AnyQueryAst } from "@prisma/orm-postgres/relational-core/ast";
import type { FakeLedgerRow, FakeSavedRouteRow } from "./fake-users-rows";
import { ledgerKey } from "./fake-users-rows";
import {
  insertValues, matches, project, projectionOf, tableOf, updateValues, type Row,
} from "./prisma-plan-ast";

/** The instant this data plane's column defaults speak, so nothing depends on a clock. */
const DEFAULT_NOW = "2026-07-13T04:00:00.000Z";

const SAVED_ROUTE_TABLE = "saved_routes";
const IDEMPOTENCY_TABLE = "saved_route_idempotency";

/** The failure a duplicate composite key raises, as this data plane's driver
 * reports it — the seam's `uniqueViolation` option, or the default below. */
export type UniqueViolation = (table: string) => Error;

/** The driver error a repeated insert raises. It carries the NORMALIZED shape
 * the runtime hands application code — `sqlState` and `table` on the error
 * itself, not `pg`'s raw `code` — so the pool exercises the reader production
 * uses rather than an imaginary one. The real stack's shape is pinned by
 * test/saved-routes.integration.test.ts. */
class FakeUniqueViolation extends Error {
  readonly sqlState = "23505";
  readonly table: string;

  constructor(table: string) {
    super(`duplicate key value violates unique constraint on "${table}"`);
    this.table = table;
  }
}

/** The two tables this data plane holds, by reference. */
export interface FakeUsersTables {
  readonly routes: FakeSavedRouteRow[];
  readonly ledger: Map<string, FakeLedgerRow>;
}

/** Both tables' contents at one instant, as a transaction's rollback point. */
export interface FakeTablesSnapshot {
  readonly routes: FakeSavedRouteRow[];
  readonly ledger: Map<string, FakeLedgerRow>;
}

/** The tables a fresh double starts from, seeded with `seed`. */
export function usersTables(seed: readonly FakeSavedRouteRow[]): FakeUsersTables {
  return { routes: [...seed], ledger: new Map() };
}

/** Both tables as they stand now — what a transaction rolls back to. */
export function snapshotTables(tables: FakeUsersTables): FakeTablesSnapshot {
  return { routes: [...tables.routes], ledger: new Map(tables.ledger) };
}

/** Restore both tables in place, so exposed references stay live. */
export function restoreTables(tables: FakeUsersTables, snapshot: FakeTablesSnapshot): void {
  tables.routes.splice(0, tables.routes.length, ...snapshot.routes);
  tables.ledger.clear();
  for (const [key, row] of snapshot.ledger) tables.ledger.set(key, row);
}

let minted = 0;

/** The `uuidv7()` column default, stood in for deterministically. */
function mintedRouteId(): string {
  minted += 1;
  return `00000000-0000-7000-8000-${String(minted).padStart(12, "0")}`;
}

/** The columns a write's `returning(...)` list names, in order. */
function returningOf(ast: AnyQueryAst): string[] {
  return projectionOf((ast as { returning?: readonly unknown[] }).returning);
}

/** The route INSERT. The id is the database's `uuidv7()` default, so a supplied
 * one is refused rather than quietly honoured. */
function insertRoute(values: Row, returning: readonly string[], tables: FakeUsersTables): Row[] {
  if ("id" in values) throw new Error("saved_routes.id is the database's uuidv7() default, never a supplied value");
  const row = {
    id: mintedRouteId(), user_id: null, title: null, point_ids: [],
    status: "draft", saved_at: null, updated_at: DEFAULT_NOW, ...values,
  } as unknown as FakeSavedRouteRow;
  tables.routes.push(row);
  return [project(row as unknown as Row, returning)];
}

/** The ledger INSERT. Its composite primary key is the ledger's only unique
 * constraint, so a repeated one is the driver's unique violation. */
function insertLedgerRow(values: Row, returning: readonly string[], tables: FakeUsersTables, failure?: UniqueViolation): Row[] {
  const key = ledgerKey(String(values.owner_user_id), String(values.op), String(values.key));
  if (tables.ledger.has(key)) throw failure?.(IDEMPOTENCY_TABLE) ?? new FakeUniqueViolation(IDEMPOTENCY_TABLE);
  const row = {
    owner_user_id: "", op: "", key: "", fingerprint: "", state: "in_progress",
    result: null, result_id: null, created_at: DEFAULT_NOW, expires_at: DEFAULT_NOW, ...values,
  } as unknown as FakeLedgerRow;
  tables.ledger.set(key, row);
  return [project(row as unknown as Row, returning)];
}

/** One INSERT against the in-memory tables, by the table it names. */
function runInsert(ast: AnyQueryAst, tables: FakeUsersTables, failure?: UniqueViolation): Row[] {
  const table = tableOf(ast);
  const values = insertValues(ast);
  const returning = returningOf(ast);
  if (table === SAVED_ROUTE_TABLE) return insertRoute(values, returning, tables);
  if (table === IDEMPOTENCY_TABLE) return insertLedgerRow(values, returning, tables, failure);
  throw new Error(`fakeUsersPrisma cannot insert into '${table}'`);
}

/** One UPDATE against the in-memory tables. */
function runUpdate(ast: AnyQueryAst, tables: FakeUsersTables): Row[] {
  const table = tableOf(ast);
  const where = (ast as { where?: unknown }).where;
  const values = updateValues(ast);
  const rows = table === SAVED_ROUTE_TABLE ? (tables.routes as unknown as Row[]) : [...tables.ledger.values()] as unknown as Row[];
  const touched = rows.filter((row) => matches(where, row));
  for (const row of touched) Object.assign(row, values);
  return touched.map((row) => project(row, returningOf(ast)));
}

/** One SELECT or DELETE against the in-memory tables. */
function runRead(ast: AnyQueryAst, tables: FakeUsersTables): Row[] {
  const table = tableOf(ast);
  const where = (ast as { where?: unknown }).where;
  const rows = table === SAVED_ROUTE_TABLE ? (tables.routes as unknown as Row[]) : [...tables.ledger.values()] as unknown as Row[];
  const matched = rows.filter((row) => matches(where, row));
  if (ast.kind === "select") return matched.map((row) => project(row, projectionOf((ast as { projection?: readonly unknown[] }).projection)));
  for (const row of matched) tables.routes.splice(tables.routes.indexOf(row as unknown as FakeSavedRouteRow), 1);
  return matched.map((row) => project(row, returningOf(ast)));
}

/** Run one plan's AST against the in-memory tables. */
export function executePlan(ast: AnyQueryAst, tables: FakeUsersTables, failure?: UniqueViolation): readonly Row[] {
  switch (ast.kind) {
    case "insert": return runInsert(ast, tables, failure);
    case "update": return runUpdate(ast, tables);
    case "delete":
    case "select": return runRead(ast, tables);
    default: throw new Error(`fakeUsersPrisma cannot run a '${ast.kind}' plan`);
  }
}
