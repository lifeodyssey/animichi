/**
 * Doubles for the users query layer's Prisma seam (#1632).
 *
 * The BUILDER is the real one (`usersClient().sql`). Building a plan is pure —
 * it binds no connection, reads no row and touches no runtime — and using the
 * real builder is what keeps a double from drifting away from the contract the
 * production plan is built from: a column the contract does not declare fails
 * here exactly as it would in the Worker.
 *
 * The EXECUTOR is what a test replaces, and it is an in-memory data plane: it
 * reads the plan's AST (which carries each bound `ParamRef`'s value), evaluates
 * the WHERE tree against the rows it holds, applies the write and projects the
 * `returning(...)` list. That is what makes `rowCount`, "exactly one statement"
 * and "scoped to the owning user" assertions still mean something now that no
 * SQL text exists to capture — and it is strictly more honest than the old
 * fake, which matched rendered SQL by substring.
 *
 * What it refuses to model, it refuses loudly: a computed projection, an
 * operator it does not know, or an INSERT that supplies `saved_routes.id`
 * throws instead of quietly answering. A predicate the fake silently skipped
 * would make every scoping assertion in the suite pass for free.
 */
import type { AnyQueryAst } from "@prisma/orm-postgres/relational-core/ast";
import type { SqlOrmPlan } from "@prisma/orm-postgres/relational-core/types";
import { usersClient, type UsersPlanExecutor, type UsersPrisma } from "../src/db/prisma";

/** One saved_routes row as the in-memory store holds it. */
export interface FakeSavedRouteRow {
  id: string;
  user_id: string | null;
  title: string | null;
  point_ids: string[];
  status: string;
  saved_at: string | null;
  updated_at: string;
}

/** One saved_route_idempotency row (issue #1011). `created_at` is nullable in
 * the contract (`createdAt TimestamptzString?`), so a row that never got the
 * column default is a state the adapter reads. */
export interface FakeLedgerRow {
  owner_user_id: string;
  op: string;
  key: string;
  fingerprint: string;
  state: "in_progress" | "committed";
  result: unknown;
  result_id: string | null;
  created_at: string | null;
  expires_at: string;
}

/** Every plan a test executed, in order — the stand-in for a SQL recorder. */
export interface RecordedPlan {
  readonly kind: string;
  readonly table: string;
}

export interface FakeUsersPrisma {
  readonly prisma: UsersPrisma;
  readonly rows: FakeSavedRouteRow[];
  readonly idemRows: Map<string, FakeLedgerRow>;
  readonly queries: RecordedPlan[];
}

export interface FakeUsersPrismaOptions {
  /**
   * Run before the plan at `index` (0-based) executes. This is how a test stages
   * a race between two statements — e.g. dropping the row between an ownership
   * read and the guarded write it authorises.
   */
  readonly beforePlan?: (index: number, queries: readonly RecordedPlan[]) => void;
  /**
   * Answer the plan with no rows, after applying it — a statement whose
   * `RETURNING` came back empty, the shape a `BEFORE INSERT` trigger suppressing
   * a row leaves behind. That empty answer is what the adapters' `row ===
   * undefined` guards exist for, and no plan the fake models produces it by
   * itself.
   */
  readonly emptyReturning?: (plan: RecordedPlan) => boolean;
  /**
   * The failure a duplicate composite key raises, as this data plane's driver
   * reports it. The default is the shape the runtime hands application code —
   * `FakeUniqueViolation`, carrying `sqlState` and `table` — and the option is
   * how a test stages the shapes a raw-SQL path or a wrapped runtime failure
   * leaves behind instead.
   */
  readonly uniqueViolation?: (table: string) => Error;
}

/** The ledger's composite key, as one string — its `Map` key in this fake. */
export function ledgerKey(ownerUserId: string, op: string, key: string): string {
  return [ownerUserId, op, key].join(":");
}

/** The instant this fake's column defaults speak, so nothing depends on a clock. */
const DEFAULT_NOW = "2026-07-13T04:00:00.000Z";

const SAVED_ROUTE_TABLE = "saved_routes";
const IDEMPOTENCY_TABLE = "saved_route_idempotency";

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

type Row = Record<string, unknown>;

/** The AST node fields this fake reads, by `kind`. */
interface AstNodeView {
  readonly kind: string;
  readonly value?: unknown;
  readonly column?: string;
  readonly name?: string;
  readonly alias?: string;
  readonly op?: string;
  readonly exprs?: readonly unknown[];
  readonly left?: unknown;
  readonly right?: unknown;
  readonly expr?: unknown;
}

function nodeOf(expr: unknown): AstNodeView {
  return expr as AstNodeView;
}

/** The value a value-position expression carries; column refs are not values. */
function valueOf(expr: unknown, row: Row): unknown {
  const node = nodeOf(expr);
  if (node.kind === "param-ref" || node.kind === "literal") return node.value;
  if (node.kind === "column-ref") return row[node.column ?? ""];
  // A column named without its table qualifier — how the builder renders a
  // WHERE operand and a plain projection entry.
  if (node.kind === "identifier-ref") return row[node.name ?? ""];
  throw new Error(`fakeUsersPrisma cannot read a '${node.kind}' expression as a value`);
}

/** The column a projection entry names; a computed expression is not one. */
function projectionColumn(item: unknown): string {
  const node = nodeOf(item);
  if (node.kind !== "projection-item") throw new Error(`fakeUsersPrisma cannot project a '${node.kind}'`);
  const expr = nodeOf(node.expr);
  if (expr.kind !== "column-ref" && expr.kind !== "identifier-ref") {
    throw new Error("fakeUsersPrisma only projects plain columns");
  }
  return node.alias ?? "";
}

/** Order two values: timestamps by instant, everything else as it stands. */
function ordered(left: unknown, right: unknown): number {
  if (typeof left === "string" && typeof right === "string") {
    const [a, b] = [Date.parse(left), Date.parse(right)];
    if (Number.isFinite(a) && Number.isFinite(b)) return a - b;
  }
  return (left as never) < (right as never) ? -1 : (left as never) > (right as never) ? 1 : 0;
}

/** One comparison operator, as the builder renders it. */
function compare(op: string | undefined, left: unknown, right: unknown): boolean {
  switch (op) {
    case "eq": return left === right;
    case "neq": return left !== right;
    case "lt": return ordered(left, right) < 0;
    case "lte": return ordered(left, right) <= 0;
    case "gt": return ordered(left, right) > 0;
    case "gte": return ordered(left, right) >= 0;
    default: throw new Error(`fakeUsersPrisma cannot evaluate the '${op ?? "?"}' operator`);
  }
}

/** Evaluate a plan's WHERE against one row. An unknown shape throws: a predicate
 * this fake skipped would make every scoping assertion pass for free. */
function matches(expr: unknown, row: Row): boolean {
  if (expr === undefined) return true;
  const node = nodeOf(expr);
  if (node.kind === "and") return (node.exprs ?? []).every((part) => matches(part, row));
  if (node.kind === "or") return (node.exprs ?? []).some((part) => matches(part, row));
  if (node.kind === "binary") return compare(node.op, valueOf(node.left, row), valueOf(node.right, row));
  throw new Error(`fakeUsersPrisma cannot evaluate a '${node.kind}' predicate`);
}

/** The table a plan names. */
function tableOf(ast: AnyQueryAst): string {
  const source = nodeOf((ast as { table?: unknown; from?: unknown }).table ?? (ast as { from?: unknown }).from);
  if (typeof source.name !== "string") throw new Error(`fakeUsersPrisma cannot name the table of a '${ast.kind}' plan`);
  return source.name;
}

/** The columns a `select(...)` / `returning(...)` list names, in order. */
function projectionOf(items: readonly unknown[] | undefined): string[] {
  return (items ?? []).map(projectionColumn);
}

/** Project one row down to the named columns. */
function project(row: Row, columns: readonly string[]): Row {
  return Object.fromEntries(columns.map((column) => [column, row[column]]));
}

/** The values an INSERT carries, per column; `default-value` stays unset. */
function insertValues(ast: AnyQueryAst): Row {
  const [first] = (ast as { rows?: readonly Row[] }).rows ?? [];
  if (first === undefined) throw new Error("fakeUsersPrisma cannot insert zero rows");
  return Object.fromEntries(
    Object.entries(first).filter(([, expr]) => nodeOf(expr).kind !== "default-value").map(([column, expr]) => [column, valueOf(expr, {})]),
  );
}

/** The values an UPDATE sets, per column. */
function updateValues(ast: AnyQueryAst): Row {
  const set = (ast as { set?: Record<string, unknown> }).set ?? {};
  return Object.fromEntries(
    Object.entries(set).map(([column, expr]) => [column, valueOf(expr, {})]),
  );
}

let minted = 0;

/** The `uuidv7()` column default, stood in for deterministically. */
function mintedRouteId(): string {
  minted += 1;
  return `00000000-0000-7000-8000-${String(minted).padStart(12, "0")}`;
}

/** One INSERT against the in-memory tables. */
function runInsert(ast: AnyQueryAst, state: FakeState, options: FakeUsersPrismaOptions): Row[] {
  const table = tableOf(ast);
  const values = insertValues(ast);
  if (table === SAVED_ROUTE_TABLE) {
    if ("id" in values) throw new Error("saved_routes.id is the database's uuidv7() default, never a supplied value");
    const row = {
      id: mintedRouteId(), user_id: null, title: null, point_ids: [],
      status: "draft", saved_at: null, updated_at: DEFAULT_NOW, ...values,
    } as unknown as FakeSavedRouteRow;
    state.routes.push(row);
    return [project(row as unknown as Row, projectionOf((ast as { returning?: readonly unknown[] }).returning))];
  }
  if (table === IDEMPOTENCY_TABLE) {
    const key = ledgerKey(String(values.owner_user_id), String(values.op), String(values.key));
    if (state.ledger.has(key)) throw options.uniqueViolation?.(IDEMPOTENCY_TABLE) ?? new FakeUniqueViolation(IDEMPOTENCY_TABLE);
    const row = {
      owner_user_id: "", op: "", key: "", fingerprint: "", state: "in_progress",
      result: null, result_id: null, created_at: DEFAULT_NOW, expires_at: DEFAULT_NOW, ...values,
    } as unknown as FakeLedgerRow;
    state.ledger.set(key, row);
    return [project(row as unknown as Row, projectionOf((ast as { returning?: readonly unknown[] }).returning))];
  }
  throw new Error(`fakeUsersPrisma cannot insert into '${table}'`);
}

/** One UPDATE against the in-memory tables. */
function runUpdate(ast: AnyQueryAst, state: FakeState): Row[] {
  const table = tableOf(ast);
  const where = (ast as { where?: unknown }).where;
  const values = updateValues(ast);
  const rows = table === SAVED_ROUTE_TABLE ? (state.routes as unknown as Row[]) : [...state.ledger.values()] as unknown as Row[];
  const touched = rows.filter((row) => matches(where, row));
  for (const row of touched) Object.assign(row, values);
  return touched.map((row) => project(row, projectionOf((ast as { returning?: readonly unknown[] }).returning)));
}

/** One SELECT or DELETE against the in-memory tables. */
function runRead(ast: AnyQueryAst, state: FakeState): Row[] {
  const table = tableOf(ast);
  const where = (ast as { where?: unknown }).where;
  const rows = table === SAVED_ROUTE_TABLE ? (state.routes as unknown as Row[]) : [...state.ledger.values()] as unknown as Row[];
  const matched = rows.filter((row) => matches(where, row));
  if (ast.kind === "select") return matched.map((row) => project(row, projectionOf((ast as { projection?: readonly unknown[] }).projection)));
  for (const row of matched) state.routes.splice(state.routes.indexOf(row as unknown as FakeSavedRouteRow), 1);
  return matched.map((row) => project(row, projectionOf((ast as { returning?: readonly unknown[] }).returning)));
}

interface FakeState { routes: FakeSavedRouteRow[]; ledger: Map<string, FakeLedgerRow> }

/** Run one plan against the in-memory tables, recording what was asked. */
function runPlan(plan: unknown, state: FakeState, queries: RecordedPlan[], options: FakeUsersPrismaOptions): readonly Row[] {
  const ast = (plan as { ast: AnyQueryAst }).ast;
  queries.push({ kind: ast.kind, table: tableOf(ast) });
  switch (ast.kind) {
    case "insert": return runInsert(ast, state, options);
    case "update": return runUpdate(ast, state);
    case "delete":
    case "select": return runRead(ast, state);
    default: throw new Error(`fakeUsersPrisma cannot run a '${ast.kind}' plan`);
  }
}

/** Restore both tables in place, so exposed references stay live. */
function restore(state: FakeState, snapshot: { routes: FakeSavedRouteRow[]; ledger: Map<string, FakeLedgerRow> }): void {
  state.routes.splice(0, state.routes.length, ...snapshot.routes);
  state.ledger.clear();
  for (const [key, row] of snapshot.ledger) state.ledger.set(key, row);
}

/** Build an in-memory Prisma seam seeded with `seed`. */
export function fakeUsersPrisma(
  seed: FakeSavedRouteRow[] = [],
  options: FakeUsersPrismaOptions = {},
): FakeUsersPrisma {
  const state: FakeState = { routes: [...seed], ledger: new Map() };
  const queries: RecordedPlan[] = [];
  // The hook's index counts the statements the executor was ASKED for, so it
  // advances whether or not the plan gets recorded: tied to `queries.length`, a
  // hook that throws leaves the index unadvanced, and the next statement's hook
  // fires at the same index and throws the same failure again.
  let planIndex = 0;
  const executor: UsersPlanExecutor = {
    query: <Row>(plan: SqlOrmPlan<Row>) => {
      const index = planIndex;
      planIndex += 1;
      options.beforePlan?.(index, queries);
      const rows = runPlan(plan, state, queries, options) as readonly Row[];
      const executed = queries[queries.length - 1];
      if (executed !== undefined && options.emptyReturning?.(executed)) return Promise.resolve<readonly Row[]>([]);
      return Promise.resolve(rows);
    },
  };
  return {
    prisma: {
      builder: usersClient().sql,
      executor,
      transaction: async (fn) => {
        const snapshot = { routes: [...state.routes], ledger: new Map(state.ledger) };
        try {
          return await fn(executor);
        } catch (error) {
          restore(state, snapshot);
          throw error;
        }
      },
    },
    rows: state.routes,
    idemRows: state.ledger,
    queries,
  };
}

/** No plan may reach this seam; for tests that must not touch Prisma at all.
 * The refusal is a rejection at the execution seam — the same place and the same
 * async shape a real driver failure arrives in — so a test asserting that a
 * persistence failure propagates is asserting the production path. */
export function unreachableUsersPrisma(): UsersPrisma {
  const refuse = (): Promise<never> => Promise.reject(new Error("the Prisma seam should not be reached"));
  return { builder: usersClient().sql, executor: { query: refuse }, transaction: refuse };
}
