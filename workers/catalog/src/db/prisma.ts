/**
 * The catalog's Prisma data-plane access (#1628, spec §4.2).
 *
 * One construction site: the shared contract (`@animichi/pi-session-neon`) plus
 * the private geography pack's runtime descriptor, which the contract's
 * `points.location` column requires on every client built from it.
 *
 * The client holds the contract and the execution stack — never a connection.
 * Closure-cached connections are unsafe in a stateless Worker (stale sockets
 * after isolate idle, concurrent-query races on a shared `pg.Client`, no clean
 * shutdown), so the shape is per request: the `/catalog/*` boundary acquires a
 * `Runtime` with {@link acquireCatalogRuntime} and disposes it with `await using`
 * on scope exit. What the per-request boundary pays for that is one TCP+TLS
 * connect per catalog request — the price spec §4.2 names, with the staging
 * measurement owed by §6.2.
 *
 * The client itself is memoized because it is stateless: building it
 * deserializes and validates the contract, work that has nothing to do with a
 * request.
 */
import { geographyRuntimeDescriptor } from "@animichi/prisma-geography/runtime";
import contractJson from "@animichi/pi-session-neon/contract" with { type: "json" };
import type { Contract } from "@animichi/pi-session-neon/types";
import type { SqlOrmPlan } from "@prisma/orm-postgres/relational-core/types";
import type { PostgresServerlessClient } from "@prisma/orm-postgres/serverless";
import postgresServerless from "@prisma/orm-postgres/serverless";

/** The serverless client shape for the shared contract. */
type CatalogClient = PostgresServerlessClient<Contract>;

/** This request's runtime: what executes a built plan, and the thing `await using` disposes. */
export type CatalogRuntime = Awaited<ReturnType<CatalogClient["connect"]>>;

/** The contract-bound statement builder (plan construction only — it never executes). */
export type CatalogStatementBuilder = CatalogClient["sql"];

/**
 * The one execution call a query adapter makes on a request's runtime.
 *
 * Stated structurally rather than as the runtime type itself, so the adapters
 * depend on the capability and not on the driver — the same inversion the
 * `DbExecutor` seam (#992) granted, with the implementation swapped.
 */
export interface CatalogPlanExecutor {
  query<Row>(plan: SqlOrmPlan<Row>): PromiseLike<readonly Row[]>;
}

/**
 * One transaction on a request's runtime. Stated structurally for the same
 * reason as {@link CatalogPlanExecutor}: the batch depends on the capability,
 * not on the driver that provides it.
 */
export interface CatalogTransaction extends CatalogPlanExecutor {
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

/**
 * What a query adapter is handed for one request: the contract's statement
 * builder, this request's executor, and the ability to run several statements
 * as one unit.
 *
 * Statement building and execution stay separate, as they were under the
 * `DbExecutor` seam (#992) — only the implementation behind them changed.
 */
export interface CatalogPrisma {
  readonly builder: CatalogStatementBuilder;
  readonly executor: CatalogPlanExecutor;
  /** Run `fn` in one transaction; commits when it resolves, rolls back when it throws. */
  transaction<T>(fn: (query: CatalogPrisma) => PromiseLike<T>): Promise<T>;
}

let client: CatalogClient | undefined;

/** The one catalog client, built on first use and reused for its lifetime. */
export function catalogClient(): CatalogClient {
  client ??= postgresServerless<Contract>({ contractJson, extensions: [geographyRuntimeDescriptor] });
  return client;
}

/** Acquire this request's runtime. The caller disposes it on scope exit. */
export function acquireCatalogRuntime(url: string): Promise<CatalogRuntime> {
  return catalogClient().connect({ url });
}

/** Pair the shared builder with one request's runtime. */
export function catalogPrisma(runtime: CatalogRuntime): CatalogPrisma {
  return { builder: catalogClient().sql, executor: runtime, transaction: (fn) => inCatalogTransaction(runtime, fn) };
}

/**
 * Run `fn` in one transaction on this request's runtime: commit when it
 * resolves, roll back when it throws, and give the connection back either way.
 *
 * This is what the `db.batch` calls (§2.3 of the Prisma spec) become: neon-http
 * had no client transaction, so the atomic units were batches; a real
 * transaction can read its own writes and is what a multi-statement publish
 * needs. `fn` receives a {@link CatalogPrisma} bound to the transaction, so the
 * statements inside stay the same builder plans they are outside it.
 *
 * The connection is `destroy`ed rather than released when the rollback itself
 * fails: the driver says that leaves the socket indeterminate, and reusing it
 * would poison the next statement.
 */
export async function inCatalogTransaction<T>(
  runtime: CatalogRuntime,
  fn: (query: CatalogPrisma) => PromiseLike<T>,
): Promise<T> {
  const connection = await runtime.connection();
  const transaction = await connection.transaction();
  try {
    const value = await fn(bindTransaction(transaction));
    await transaction.commit();
    return value;
  } catch (error) {
    await rollbackOrDestroy(connection, transaction, error);
    throw error;
  } finally {
    await connection.release();
  }
}

/**
 * The transaction as a {@link CatalogPrisma}. Its `transaction` JOINS the open
 * transaction rather than opening a second one: Postgres has no nested
 * transactions, and a helper that silently started a parallel connection would
 * make the atomicity it promises a lie.
 */
function bindTransaction(transaction: CatalogTransaction): CatalogPrisma {
  const bound: CatalogPrisma = {
    builder: catalogClient().sql,
    executor: transaction,
    transaction: (fn) => Promise.resolve(fn(bound)),
  };
  return bound;
}

/** Roll back, evicting the connection when even that fails. */
async function rollbackOrDestroy(
  connection: { destroy(reason?: unknown): Promise<void> },
  transaction: CatalogTransaction,
  reason: unknown,
): Promise<void> {
  try {
    await transaction.rollback();
  } catch {
    await connection.destroy(reason);
  }
}
