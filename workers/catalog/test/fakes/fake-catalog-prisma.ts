/**
 * Doubles for the nearby path's Prisma seam (#1628).
 *
 * The BUILDER is the real one (`catalogClient().sql`). Building a plan is pure —
 * it binds no connection, reads no row and touches no runtime — and using the
 * real builder is what keeps a double from drifting away from the contract the
 * production plan is built from: a column the contract does not declare fails
 * here exactly as it would in the Worker.
 *
 * The EXECUTOR is what a test replaces. `fakeCatalogPrisma(...answers)` hands
 * back one answer list per `query()` call, in call order (the nearby path reads
 * geo first, details second).
 *
 * The TRANSACTION joins the open one rather than opening a second connection, as
 * a transaction-bound seam does in `src/db/prisma.ts`: a fake that ran `fn` on a
 * different path than the one the caller passed would not be a double of the
 * capability it stands in for.
 */
import type { CatalogPlanExecutor, CatalogPrisma } from "../../src/db/prisma";
import { catalogClient } from "../../src/db/prisma";

/** An executor that answers the declared row lists in call order. */
function executorAnswering(answers: readonly (readonly unknown[])[]): CatalogPlanExecutor {
  let calls = 0;
  return {
    // `never[]` is the bottom of every row type, so the fake stays cast-free
    // while the generic signature is satisfied for any `Row`.
    query: () => Promise.resolve((answers[calls++] ?? []) as readonly never[]),
  };
}

/**
 * A seam whose `transaction` runs `fn` on the same bound seam (no nesting) —
 * the transaction-bound shape `src/db/prisma.ts` gives a request.
 *
 * Exported for the tests that build a seam over a REAL runtime
 * (`nearby-plan.ts`, `outbound-adapters.integration.test.ts`): those already
 * have their executor, and this is the one member left to state.
 */
export function withJoinedTransaction(seam: Omit<CatalogPrisma, "transaction">): CatalogPrisma {
  const bound: CatalogPrisma = { ...seam, transaction: (fn) => Promise.resolve(fn(bound)) };
  return bound;
}

/** A seam whose `transaction` runs `fn` on the same bound seam (no nesting). */
function joined<T>(seam: CatalogPrisma, fn: (query: CatalogPrisma) => PromiseLike<T>): Promise<T> {
  return Promise.resolve(fn(seam));
}

/** The real builder paired with an executor answering `answers` in order. */
export function fakeCatalogPrisma(...answers: readonly (readonly unknown[])[]): CatalogPrisma {
  const seam: CatalogPrisma = {
    builder: catalogClient().sql,
    executor: executorAnswering(answers),
    transaction: (fn) => joined(seam, fn),
  };
  return seam;
}

/**
 * {@link fakeCatalogPrisma} with the executor's call count exposed.
 *
 * A converted adapter's operation count is a shape fact — "this read is ONE
 * statement" — so the tests that assert it need to read the count back rather
 * than infer it from the answers list running dry.
 */
export interface CountingCatalogPrisma {
  /** The seam to hand the adapter under test. */
  readonly query: CatalogPrisma;
  /** Statements the adapter has executed so far. */
  statements(): number;
}

/** The real builder paired with a counting executor over `answers`. */
export function countingCatalogPrisma(
  ...answers: readonly (readonly unknown[])[]
): CountingCatalogPrisma {
  let calls = 0;
  const answering = executorAnswering(answers);
  const seam: CatalogPrisma = {
    builder: catalogClient().sql,
    executor: {
      query: (plan) => {
        calls += 1;
        return answering.query(plan);
      },
    },
    transaction: (fn) => joined(seam, fn),
  };
  return {
    query: seam,
    statements: () => calls,
  };
}

/** A seam whose builder AND executor both fail: for tests that must not reach Prisma. */
export function unreachableCatalogPrisma(): CatalogPrisma {
  const refuse = (): never => {
    throw new Error("the Prisma seam should not be reached");
  };
  const seam: CatalogPrisma = {
    builder: new Proxy(catalogClient().sql, { get: () => refuse() }),
    executor: { query: refuse },
    transaction: refuse,
  };
  return seam;
}

/**
 * A seam whose rows are keyed by the table a SELECT plan reads — the Prisma
 * double for the reads that name one table and take no predicate, such as the
 * candidate export's six. Keyed rather than positional for the reason the
 * Drizzle fake was: a test says which table it is about (`{ points: rows }`)
 * instead of counting commas, and a reordered read cannot hand one table's rows
 * to another table's SELECT.
 */
export function fakeTableRows(rows: Readonly<Record<string, readonly unknown[]>>): CatalogPrisma {
  const seam: CatalogPrisma = {
    builder: catalogClient().sql,
    executor: { query: (plan) => Promise.resolve((rows[planTable(plan)] ?? []) as readonly never[]) },
    transaction: (fn) => joined(seam, fn),
  };
  return seam;
}

/**
 * The table a plan names, whichever kind it is: a SELECT carries its source
 * under `from`, an INSERT / UPDATE / DELETE under `table`. Reading only one of
 * them would silently answer "" for every write, which is how a fake starts
 * agreeing with a plan it never looked at.
 */
export function planTable(plan: { readonly ast: unknown }): string {
  const ast = plan.ast as {
    readonly from?: { readonly name?: unknown };
    readonly table?: { readonly name?: unknown };
  };
  const named = ast.from ?? ast.table;
  return typeof named?.name === "string" ? named.name : "";
}

/**
 * One injected failure for {@link failingCatalogPrisma}: the statement's
 * 0-based position within the unit, the table it names, or both. Omitting a
 * condition means "any", and a failure that names neither matches everything.
 */
export interface CatalogPlanFailure {
  readonly atIndex?: number;
  readonly onTable?: string;
  readonly error: Error;
}

/**
 * A seam whose executor throws the first failure matching the statement it was
 * handed. The position is counted across the whole unit, so a transaction's
 * third statement is index 2 whether or not the ones before it were reads.
 */
export function failingCatalogPrisma(...failures: readonly CatalogPlanFailure[]): CatalogPrisma {
  let index = 0;
  const seam: CatalogPrisma = {
    builder: catalogClient().sql,
    executor: {
      query: (plan) => {
        const failure = matchingFailure(failures, planTable(plan), index++);
        if (failure !== undefined) return Promise.reject(failure);
        return Promise.resolve([] as readonly never[]);
      },
    },
    transaction: (fn) => joined(seam, fn),
  };
  return seam;
}

/** The first failure whose every stated condition holds for this statement. */
function matchingFailure(
  failures: readonly CatalogPlanFailure[], table: string, index: number,
): Error | undefined {
  return failures.find((failure) =>
    (failure.atIndex === undefined || failure.atIndex === index)
    && (failure.onTable === undefined || failure.onTable === table))?.error;
}
