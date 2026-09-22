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
 * Teardown is OUTSIDE the unit's `try`, and the distinction is load-bearing. A
 * failing `release` is a teardown failure, not a unit failure: caught by the
 * unit-failure arm it would send a transaction that already COMMITTED to
 * `rollback()`, and because the driver's `rollback()` has no settled guard — a
 * bare `ROLLBACK` outside a transaction is a WARNING, not an error — the arm
 * would then reach a SECOND `release()`. Hoisted, a failing `release` reaches
 * the caller as itself, with no rollback and exactly one release.
 *
 * That is the ONE path where a failed teardown is the caller's to see, because
 * it is the only path with no error of the caller's own to report instead.
 *
 * The connection is `destroy`ed rather than released when the rollback itself
 * fails: the driver says that leaves the socket indeterminate, and reusing it
 * would poison the next statement. A destroyed connection is NOT also released
 * — the driver's connection contract calls a second teardown after destroy a
 * caller error. The same eviction covers a transaction that could not even be
 * OPENED, and the driver's contract is explicit about that one: `release()`
 * "must only be called when the connection is known to be in a clean, reusable
 * state", and it names a failed transaction operation — or a connection that is
 * "otherwise suspect" — as the case for `destroy(reason)` instead. A rejected
 * `BEGIN` establishes neither, because a failed round-trip is not a statement
 * error the server answered: nothing here knows the socket survived it. Every
 * remaining path — commit and rolled-back failure — releases exactly once.
 *
 * A failing `destroy` does not replace the caller's error, and neither does a
 * failing `release` on a failure path. The teardown failure is never raised: it
 * becomes CONTEXT for the unit's own error — recorded on it as `cause` — when
 * that error can take one and does not already carry a cause value, and is
 * dropped otherwise ({@link attachCause}). Swallowing a failed EVICTION rests on
 * the driver's contract, which leaves a connection whose `destroy` failed
 * retryable so a follow-up call can still dispose of the handle; a failed
 * `release` needs no such premise, because both of its callers already hold an
 * error of their own ({@link releaseQuietly}). Wrapping the unit's error, as the
 * driver's own `withTransaction` does, would change the error identity
 * `classifyIngestFailure` matches on.
 */
export async function inCatalogTransaction<T>(
  runtime: CatalogRuntime,
  fn: (query: CatalogPrisma) => PromiseLike<T>,
): Promise<T> {
  const connection = await runtime.connection();
  let transaction: CatalogTransaction;
  try {
    transaction = await connection.transaction();
  } catch (error) {
    await evict(connection, error);
    throw error;
  }
  let value: T;
  try {
    value = await fn(bindTransaction(transaction));
    await transaction.commit();
  } catch (error) {
    await settleFailed(connection, transaction, error);
    throw error;
  }
  await connection.release();
  return value;
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

/**
 * Settle a failed unit: roll back and release; evict the connection when even
 * the rollback fails.
 *
 * Never throws, on any path. The unit's own error is the caller's: a failing
 * eviction and a failing release are teardown failures, recorded on that error
 * rather than raised in its place — see {@link attachCause} for what that
 * "recorded" can promise.
 */
async function settleFailed(
  connection: { destroy(reason?: unknown): Promise<void>; release(): Promise<void> },
  transaction: CatalogTransaction,
  reason: unknown,
): Promise<void> {
  try {
    await transaction.rollback();
  } catch {
    await evict(connection, reason);
    return;
  }
  await releaseQuietly(connection, reason);
}

/**
 * Evict a suspect connection, recording a failed eviction on `reason` instead
 * of throwing it: the driver's contract leaves a connection whose `destroy`
 * failed retryable, so the caller's error has to survive the cleanup. See
 * {@link attachCause} for what that "recording" can promise.
 *
 * Nothing is owed after a failed eviction. The driver marks the connection
 * closed BEFORE it awaits the socket's `end()`, and the failure unwinds through
 * `finally` blocks that detach the connection from the driver and drop its
 * lease — so the runtime's own `await using` disposal finds no delegate left to
 * close.
 */
async function evict(
  connection: { destroy(reason?: unknown): Promise<void> },
  reason: unknown,
): Promise<void> {
  try {
    await connection.destroy(reason);
  } catch (evictionFailure) {
    attachCause(reason, evictionFailure);
  }
}

/**
 * Give the connection back, recording a failed release on `reason` instead of
 * throwing it: both callers already hold an error of their own, and that error
 * is the one the caller has to receive. See {@link attachCause} for what that
 * "recording" can promise.
 */
async function releaseQuietly(
  connection: { release(): Promise<void> },
  reason: unknown,
): Promise<void> {
  try {
    await connection.release();
  } catch (releaseFailure) {
    attachCause(reason, releaseFailure);
  }
}

/**
 * Attach a teardown failure to the error the caller will receive, when that
 * value can carry a cause and does not already carry a cause VALUE.
 *
 * Neither guard may itself become the failure: a frozen error and a non-object
 * throw cannot take the property, so the guard is this function's own `catch`
 * rather than an `instanceof` pre-check. `defineProperty` carries the descriptor
 * native `Error.cause` has; a plain assignment would make it enumerable.
 * `prisma-transaction-error-identity.worker.test.ts` asserts each of those.
 *
 * "Already carries one" is decided by VALUE (`cause === undefined`), not by the
 * key's presence: an error built with `{ cause: undefined }` names no underlying
 * failure, so there is nothing for the teardown failure to displace and it is
 * recorded there instead. An error carrying a real cause KEEPS it and the
 * teardown failure is dropped: the unit set that cause deliberately
 * (`upstream-failures.ts`, `retry.ts`) and it names what failed underneath,
 * which a teardown failure — after the unit's error, not underneath it — must
 * not replace.
 */
function attachCause(error: unknown, cause: unknown): void {
  try {
    const carrier = error as { cause?: unknown };
    if (carrier.cause === undefined) {
      Object.defineProperty(carrier, "cause", { value: cause, configurable: true, writable: true });
    }
  } catch {
    return; // A value that cannot carry the context still keeps its own error.
  }
}
