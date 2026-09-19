/**
 * Plan inspection for the worker pool (#1630).
 *
 * The Drizzle seam handed a test a rendered statement: `db.execute(query)` took
 * the `SQL` object, and `PgDialect().sqlToQuery(query)` turned it into the SQL
 * text and the bound parameter list a worker test asserts on. A builder plan is
 * not that: `SqlOrmPlan` carries an AST, and the renderer that turns it into a
 * string lives in `@prisma/orm-target-postgres`, which this package consumes
 * only TRANSITIVELY — a test may not import it.
 *
 * So the assertions move to the AST, which is what the plan actually is. The
 * nodes are plain data (`{ kind: "param-ref", value, codec }` for a bound value,
 * `{ kind: "identifier-ref", name }` for a column), so walking one costs no
 * dependency and loses no information the old assertions used: a statement count,
 * the bound values, and which columns a predicate names are all readable.
 *
 * Semantic assertions — which rows a query returns, in what order, against a real
 * Postgres — belong to the integration pool and are not replaced here.
 */
import type { CatalogPlanExecutor, CatalogPrisma } from "../../src/db/prisma";
import { catalogClient } from "../../src/db/prisma";

/** Every value the plan binds, in the order the AST carries them. */
export function planParams(plan: { readonly ast: unknown }): unknown[] {
  const collected: unknown[] = [];
  walk(plan.ast, collected);
  return collected;
}

/** Every column name the plan names, in AST order. */
export function planColumns(plan: { readonly ast: unknown }): string[] {
  const collected: string[] = [];
  walkColumns(plan.ast, collected);
  return collected;
}

/** A plan-recording seam: the real builder, an executor that records and answers. */
export interface RecordingCatalogPrisma {
  /** The seam to hand the module under test. */
  readonly query: CatalogPrisma;
  /** How many statements the module has executed so far. */
  statements(): number;
  /** The plans executed so far, in call order. */
  plans(): readonly { readonly ast: unknown }[];
  /** Every value bound by every executed plan, in order. */
  params(): unknown[];
  /** Every column named by every executed plan, in order. */
  columns(): string[];
}

/**
 * The real builder paired with an executor that records each plan and answers
 * the declared row lists in call order. The builder stays real for the reason
 * `fake-catalog-prisma.ts` gives: a column the contract does not declare fails
 * here exactly as it would in the Worker.
 */
export function recordingCatalogPrisma(
  ...answers: readonly (readonly unknown[])[]
): RecordingCatalogPrisma {
  let calls = 0;
  const executed: { readonly ast: unknown }[] = [];
  const seam: CatalogPrisma = {
    builder: catalogClient().sql,
    executor: {
      query: (plan) => {
        executed.push(plan);
        return Promise.resolve((answers[calls++] ?? []) as readonly never[]);
      },
    },
    // A transaction-bound seam joins the open one; see `fake-catalog-prisma.ts`.
    transaction: (fn) => Promise.resolve(fn(seam)),
  };
  return {
    query: seam,
    statements: () => calls,
    plans: () => executed,
    params: () => executed.flatMap(planParams),
    columns: () => executed.flatMap(planColumns),
  };
}

/** An executor that records plans and never answers a row. */
export function recordingExecutor(): CatalogPlanExecutor & { plans(): readonly { readonly ast: unknown }[] } {
  const executed: { readonly ast: unknown }[] = [];
  return {
    query: (plan) => {
      executed.push(plan);
      return Promise.resolve([] as readonly never[]);
    },
    plans: () => executed,
  };
}

function walk(node: unknown, into: unknown[]): void {
  if (Array.isArray(node)) {
    for (const item of node) walk(item, into);
    return;
  }
  if (typeof node !== "object" || node === null) return;
  const record = node as Record<string, unknown>;
  if (record.kind === "param-ref" && "value" in record) into.push(record.value);
  for (const value of Object.values(record)) walk(value, into);
}

function walkColumns(node: unknown, into: string[]): void {
  if (Array.isArray(node)) {
    for (const item of node) walkColumns(item, into);
    return;
  }
  if (typeof node !== "object" || node === null) return;
  const record = node as Record<string, unknown>;
  if (record.kind === "identifier-ref" && typeof record.name === "string") into.push(record.name);
  if (record.kind === "column-ref" && typeof record.column === "string") into.push(record.column);
  for (const value of Object.values(record)) walkColumns(value, into);
}
