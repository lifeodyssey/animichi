/**
 * The users worker's Prisma data-plane access (#1632, spec §4.2).
 *
 * One construction site: the shared contract (`@animichi/pi-session-neon`) plus
 * the private geography pack's runtime descriptor, which the contract's
 * `points.location` column requires on every client built from it — the users
 * worker never reads that column, but it builds its client from the same
 * contract the catalog does, so it carries the same descriptor.
 *
 * The serverless client holds the contract and the execution stack — never a
 * database connection. Closure-cached connections are unsafe in a stateless
 * Worker (stale sockets after isolate idle, concurrent-query races on a shared
 * `pg.Client`, no clean shutdown), so the shape is per request: the
 * `/v1/users/*` boundary opens one connection with {@link acquireUsersRuntime}
 * and disposes it with `await using` on scope exit. Since rc.14 `connect()`
 * opens the socket before it returns, so an unreachable database fails there,
 * not at the first query.
 *
 * The serverless client itself is memoized because it is stateless: building it
 * deserializes and validates the contract, work that has nothing to do with a
 * request.
 */
import { geographyRuntimeDescriptor } from "@animichi/prisma-geography/runtime";
import contractJson from "@animichi/pi-session-neon/contract" with { type: "json" };
import type { Contract } from "@animichi/pi-session-neon/types";
import type { SqlOrmPlan } from "@prisma/orm-postgres/relational-core/types";
import type { PostgresServerlessClient } from "@prisma/orm-postgres/serverless";
import postgresServerless from "@prisma/orm-postgres/serverless";
import { contractFromJson } from "@prisma/orm-postgres/static";

/** The serverless client shape for the shared contract. */
type UsersClient = PostgresServerlessClient<Contract>;

/** This request's connection: what executes a built plan, and the thing `await using` disposes. */
export type UsersRuntime = Awaited<ReturnType<UsersClient["connect"]>>;

/** The contract-bound statement builder (plan construction only — it never executes). */
export type UsersStatementBuilder = UsersClient["sql"];

/**
 * The one execution call a query adapter makes against a scope.
 *
 * Stated structurally rather than as the runtime type itself, so the adapters
 * depend on the capability and not on the driver — the same inversion the
 * `DbExecutor` seam (#992) granted, with the implementation swapped. It is also
 * what makes a transaction scope and a request runtime interchangeable here:
 * both answer a plan with its typed rows.
 */
export interface UsersPlanExecutor {
  query<Row>(plan: SqlOrmPlan<Row>): PromiseLike<readonly Row[]>;
}

/** The row a built plan resolves to, read back off the plan rather than re-declared. */
export type RowOf<Plan> = Plan extends SqlOrmPlan<infer Row> ? Row : never;

/**
 * What a query adapter is handed for one request: the contract's statement
 * builder, this request's executor, and the atomic multi-statement scope.
 * Statement building and execution stay separate, as they were under the
 * `DbExecutor` seam (#992) — only the implementation behind them changed.
 *
 * `transaction` is the one place the old `db.batch` shape is not translatable:
 * Neon's HTTP batch had no round trip, so the atomic route+ledger write had to
 * invent the route's id up front (see `neon-atomic-commit.ts`). A real
 * transaction can read statement 1's RETURNING, so the id returns to the
 * database's `uuidv7()` default — the shape `src/db/schema.ts` used to ask for
 * in prose.
 */
export interface UsersPrisma {
  readonly builder: UsersStatementBuilder;
  readonly executor: UsersPlanExecutor;
  transaction<R>(fn: (tx: UsersPlanExecutor) => Promise<R>): Promise<R>;
}

let client: UsersClient | undefined;

/** The one users serverless client, built on first use and reused for its lifetime. */
export function usersClient(): UsersClient {
  client ??= postgresServerless({
    contract: contractFromJson<Contract>(contractJson), extensions: [geographyRuntimeDescriptor],
  });
  return client;
}

/** Open this request's connection. The caller disposes it on scope exit. */
export function acquireUsersRuntime(url: string): Promise<UsersRuntime> {
  return usersClient().connect({ url });
}

/** Pair the shared builder with one request's connection; a transaction is the connection's own. */
export function usersPrisma(db: UsersRuntime): UsersPrisma {
  return {
    builder: usersClient().sql,
    executor: db,
    transaction: (fn) => db.transaction((tx) => fn(tx)),
  };
}
