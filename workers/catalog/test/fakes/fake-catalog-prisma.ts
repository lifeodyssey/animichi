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

/** The real builder paired with an executor answering `answers` in order. */
export function fakeCatalogPrisma(...answers: readonly (readonly unknown[])[]): CatalogPrisma {
  return { builder: catalogClient().sql, executor: executorAnswering(answers) };
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
  return {
    query: {
      builder: catalogClient().sql,
      executor: {
        query: (plan) => {
          calls += 1;
          return answering.query(plan);
        },
      },
    },
    statements: () => calls,
  };
}

/** A seam whose builder AND executor both fail: for tests that must not reach Prisma. */
export function unreachableCatalogPrisma(): CatalogPrisma {
  const refuse = (): never => {
    throw new Error("the Prisma seam should not be reached");
  };
  return {
    builder: new Proxy(catalogClient().sql, { get: () => refuse() }),
    executor: { query: refuse },
  };
}
