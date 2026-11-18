/**
 * Reading a built plan's AST (#1632).
 *
 * Building a plan is pure — it binds no connection, reads no row and touches no
 * runtime — so a test can hand the real builder's plan to a data plane of its
 * own. What that data plane needs is not SQL text but the plan's own data: the
 * `ParamRef` values the builder bound, the WHERE tree, the ORDER BY terms, the
 * `returning(...)` list and the table underneath. This module is the one place
 * that reads it.
 *
 * Everything here refuses a shape it cannot model rather than guessing at it: an
 * operator it does not know, a computed projection, a table it cannot name. A
 * predicate that were skipped would make every scoping assertion in the suite
 * pass for free, so silence is the one answer it must never give.
 */
import type { AnyQueryAst } from "@prisma/orm-postgres/relational-core/ast";

/** Every plan the executor was ASKED for, in order — the stand-in for a SQL
 * recorder. A statement whose hook threw is in here too: it was asked for, and
 * counting it is what keeps the next statement's hook index its own. */
export interface RecordedPlan {
  readonly kind: string;
  readonly table: string;
}

/** The AST a built plan carries. */
export function planAst(plan: unknown): AnyQueryAst {
  return (plan as { ast: AnyQueryAst }).ast;
}

/** The plan's own record: what it is, and the table it touches. */
export function describePlan(ast: AnyQueryAst): RecordedPlan {
  return { kind: ast.kind, table: tableOf(ast) };
}

/** A row as this reader indexes it: both a WHERE operand and a projection entry
 * address their column by name. */
export type Row = Record<string, unknown>;

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
  readonly dir?: string;
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

/** The comparison operators, as the builder renders them. A `Map` and not an
 * object literal: an operator the builder never renders has to reach the throw
 * below, not an inherited member. */
const COMPARISONS = new Map<string, (left: unknown, right: unknown) => boolean>([
  ["eq", (left, right) => left === right],
  ["neq", (left, right) => left !== right],
  ["lt", (left, right) => ordered(left, right) < 0],
  ["lte", (left, right) => ordered(left, right) <= 0],
  ["gt", (left, right) => ordered(left, right) > 0],
  ["gte", (left, right) => ordered(left, right) >= 0],
]);

/** Evaluate one comparison operator. An unknown one throws. */
function compare(op: string | undefined, left: unknown, right: unknown): boolean {
  const comparison = COMPARISONS.get(op ?? "");
  if (comparison === undefined) throw new Error(`fakeUsersPrisma cannot evaluate the '${op ?? "?"}' operator`);
  return comparison(left, right);
}

/** Evaluate a plan's WHERE against one row. An unknown shape throws: a predicate
 * this fake skipped would make every scoping assertion pass for free. */
export function matches(expr: unknown, row: Row): boolean {
  if (expr === undefined) return true;
  const node = nodeOf(expr);
  if (node.kind === "and") return (node.exprs ?? []).every((part) => matches(part, row));
  if (node.kind === "or") return (node.exprs ?? []).some((part) => matches(part, row));
  if (node.kind === "binary") return compare(node.op, valueOf(node.left, row), valueOf(node.right, row));
  throw new Error(`fakeUsersPrisma cannot evaluate a '${node.kind}' predicate`);
}

/** One ORDER BY term this fake applies: a plain column and its direction. */
interface OrderTerm {
  readonly column: string;
  readonly descending: boolean;
}

/** The sort directions the builder renders, and whether each is descending —
 * a `Map`, like COMPARISONS, so a direction it never renders reaches the throw. */
const DESCENDING = new Map<string, boolean>([["asc", false], ["desc", true]]);

/** An ORDER BY item naming a plain column in a known direction, as the builder
 * renders one. A computed sort key or an unknown direction throws rather than
 * being guessed at. */
function orderTerm(item: unknown): OrderTerm {
  const node = nodeOf(item);
  const expr = nodeOf(node.expr);
  const descending = DESCENDING.get(node.dir ?? "");
  if (node.kind !== "order-by-item" || expr.kind !== "identifier-ref"
    || expr.name === undefined || descending === undefined) {
    throw new Error("fakeUsersPrisma only orders by a plain column, ascending or descending");
  }
  return { column: expr.name, descending };
}

/** Compare two rows term by term; the first term that differs decides. */
function compareByTerms(left: Row, right: Row, terms: readonly OrderTerm[]): number {
  for (const term of terms) {
    const order = ordered(left[term.column], right[term.column]);
    if (order !== 0) return term.descending ? -order : order;
  }
  return 0;
}

/** Rows in the order a SELECT's ORDER BY gives them; with none, as stored. */
export function orderedRows(rows: readonly Row[], items: readonly unknown[] | undefined): Row[] {
  const terms = (items ?? []).map(orderTerm);
  return [...rows].sort((left, right) => compareByTerms(left, right, terms));
}

/** The table a plan names. */
export function tableOf(ast: AnyQueryAst): string {
  const source = nodeOf((ast as { table?: unknown; from?: unknown }).table ?? (ast as { from?: unknown }).from);
  if (typeof source.name !== "string") throw new Error(`fakeUsersPrisma cannot name the table of a '${ast.kind}' plan`);
  return source.name;
}

/** The columns a `select(...)` / `returning(...)` list names, in order. */
export function projectionOf(items: readonly unknown[] | undefined): string[] {
  return (items ?? []).map(projectionColumn);
}

/** Project one row down to the named columns. */
export function project(row: Row, columns: readonly string[]): Row {
  return Object.fromEntries(columns.map((column) => [column, row[column]]));
}

/** The values an INSERT carries, per column; `default-value` stays unset. */
export function insertValues(ast: AnyQueryAst): Row {
  const [first] = (ast as { rows?: readonly Row[] }).rows ?? [];
  if (first === undefined) throw new Error("fakeUsersPrisma cannot insert zero rows");
  return Object.fromEntries(
    Object.entries(first).filter(([, expr]) => nodeOf(expr).kind !== "default-value").map(([column, expr]) => [column, valueOf(expr, {})]),
  );
}

/** The values an UPDATE sets, per column. */
export function updateValues(ast: AnyQueryAst): Row {
  const set = (ast as { set?: Record<string, unknown> }).set ?? {};
  return Object.fromEntries(
    Object.entries(set).map(([column, expr]) => [column, valueOf(expr, {})]),
  );
}
