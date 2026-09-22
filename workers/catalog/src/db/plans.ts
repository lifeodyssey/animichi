/**
 * The two things a Prisma 8 builder plan cannot say (#1630).
 *
 * `db.sql.<ns>.<table>.insert(rows)` / `.update(set)` produce parameterised plans,
 * but the builder's surface stops at `returning`, `annotate` and `build`:
 *
 *   - an INSERT has no conflict clause, so an upsert cannot be stated. The AST
 *     beneath it models `ON CONFLICT … DO UPDATE SET` and the Postgres renderer
 *     emits exactly that form — and no conflict `WHERE`, which is why the gated
 *     claims (`ingest/jobs.ts`, `ingest/run-store.ts`) state their predicate on
 *     an `update(…)` instead;
 *   - a write value is a BOUND value, so a column cannot be assigned the
 *     database's own clock: `now()` is not something the worker can bind.
 *
 * Both are plan-level repairs on an AST the builder already produced, and both
 * hand the same plan back through `planFromAst`, so the row values, their
 * parameter binding, the projection and the result type are untouched. A repair
 * names columns; the only value one carries is the interval a clock stamp is
 * offset by, and that one is bound (`param`) rather than rendered, so there is
 * no path from caller input into SQL text here.
 */
import { ColumnRef, InsertOnConflict, RawExpr, param } from "@prisma/orm-postgres/relational-core";
import type { AnyExpression, InsertAst, UpdateAst } from "@prisma/orm-postgres/relational-core";
import { planFromAst } from "@prisma/orm-postgres/relational-core/plan";
import type { SqlOrmPlan } from "@prisma/orm-postgres/relational-core/types";
import { catalogClient } from "./prisma";

/** Which columns a conflict update overwrites with the row that was proposed. */
export interface ConflictUpdate {
  /** The conflict target columns, in the table's own names. */
  readonly target: readonly string[];
  /** Columns the update assigns from the proposed row (`EXCLUDED.<column>`). */
  readonly update: readonly string[];
}

/** Add the conflict clause to a builder-built INSERT plan, keeping its projection. */
export function upsert<Row>(insert: SqlOrmPlan<Row>, conflict: ConflictUpdate): SqlOrmPlan<Row> {
  const clause = InsertOnConflict.on(refs(conflict.target)).doUpdateSet(assignments(conflict.update));
  return planFromAst<Row>(insertAstOf(insert).withOnConflict(clause), catalogClient().contract);
}

/** Assign `now()` — the transaction timestamp — to the named columns of a write plan. */
export function atServerNow<Row>(plan: SqlOrmPlan<Row>, columns: readonly string[]): SqlOrmPlan<Row> {
  assertNamed(columns);
  return atServerClock(plan, Object.fromEntries(columns.map((name) => [name, 0])));
}

/**
 * Assign the server clock to named columns of a write plan, each offset by its
 * own number of seconds — `now() + make_interval(secs => $n)`, so a negative
 * cache's park-until is the DATABASE's clock and the offset stays a bound value.
 */
export function atServerClock<Row>(
  plan: SqlOrmPlan<Row>,
  offsets: Readonly<Record<string, number>>,
): SqlOrmPlan<Row> {
  const columns = Object.keys(offsets);
  assertNamed(columns);
  const ast = plan.ast;
  if (ast.kind === "update") return planFromAst<Row>(withStampsSet(ast, offsets), catalogClient().contract);
  if (ast.kind === "insert") {
    return planFromAst<Row>(withStampsRows(insertAstOf(plan), offsets), catalogClient().contract);
  }
  throw new Error(`expected an INSERT or UPDATE plan, received ${ast.kind}`);
}

/** Every assignment copies the proposed row's own column — never a bound value. */
function assignments(columns: readonly string[]): Record<string, AnyExpression> {
  assertNamed(columns);
  return Object.fromEntries(columns.map((name) => [name, ColumnRef.of("excluded", name)]));
}

/** The conflict target, named as `EXCLUDED`'s own columns so one list serves both halves. */
function refs(columns: readonly string[]): ColumnRef[] {
  assertNamed(columns);
  return columns.map((name) => ColumnRef.of("excluded", name));
}

/** The update's assignments with the named columns set to the server clock. */
function withStampsSet(ast: UpdateAst, offsets: Readonly<Record<string, number>>): UpdateAst {
  return ast.withSet({ ...ast.set, ...stampColumns(offsets) });
}

/** The insert's rows with the named columns set to the server clock. */
function withStampsRows(ast: InsertAst, offsets: Readonly<Record<string, number>>): InsertAst {
  return ast.withRows(ast.rows.map((row) => ({ ...row, ...stampColumns(offsets) })));
}

/** One clock stamp per named column, offset by its own seconds. */
function stampColumns(offsets: Readonly<Record<string, number>>): Record<string, RawExpr> {
  return Object.fromEntries(Object.entries(offsets).map(([name, seconds]) => [name, stamp(seconds)]));
}

/** `now() + make_interval(secs => $n)` as a fragment carrying the timestamp codec. */
function stamp(seconds: number): RawExpr {
  return new RawExpr({
    parts: ["now() + make_interval(secs => ", param(seconds, { codecId: "pg/int4@1" }), ")"],
    returns: { codecId: "pg/timestamptz-string@1", nullable: false },
  });
}

/** The plan's AST, which a builder INSERT always produces. */
function insertAstOf<Row>(insert: SqlOrmPlan<Row>): InsertAst {
  const { ast } = insert;
  if (ast.kind !== "insert") throw new Error(`expected an INSERT plan, received ${ast.kind}`);
  return ast;
}

function assertNamed(columns: readonly string[]): void {
  if (columns.length === 0) throw new Error("a plan repair needs at least one column");
}
