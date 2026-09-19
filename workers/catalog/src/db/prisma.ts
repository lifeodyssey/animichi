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
 * What a query adapter is handed for one request: the contract's statement
 * builder and this request's executor. Statement building and execution stay
 * separate, as they were under the `DbExecutor` seam (#992) — only the
 * implementation behind them changed.
 */
export interface CatalogPrisma {
  readonly builder: CatalogStatementBuilder;
  readonly executor: CatalogPlanExecutor;
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
  return { builder: catalogClient().sql, executor: runtime };
}
