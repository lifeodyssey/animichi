/**
 * The users worker's Prisma data-plane access (#1632, spec §4.2).
 *
 * One construction site: the shared contract (`@animichi/pi-session-neon`) plus
 * the private geography pack's runtime descriptor, which the contract's
 * `points.location` column requires on every client built from it — the users
 * worker never reads that column, but it builds its client from the same
 * contract the catalog does, so it carries the same descriptor.
 *
 * The client holds the contract and the execution stack — never a connection.
 * Closure-cached connections are unsafe in a stateless Worker (stale sockets
 * after isolate idle, concurrent-query races on a shared `pg.Client`, no clean
 * shutdown), so the shape is per request: the `/v1/users/*` boundary acquires a
 * `Runtime` with {@link acquireUsersRuntime} and disposes it with `await using`
 * on scope exit.
 *
 * The client itself is memoized because it is stateless: building it
 * deserializes and validates the contract, work that has nothing to do with a
 * request.
 */
import { geographyRuntimeDescriptor } from "@animichi/prisma-geography/runtime";
import contractJson from "@animichi/pi-session-neon/contract" with { type: "json" };
import type { Contract } from "@animichi/pi-session-neon/types";
import { withTransaction } from "@prisma/orm-family-sql/runtime";
import type { SqlOrmPlan } from "@prisma/orm-postgres/relational-core/types";
import type { PostgresServerlessClient } from "@prisma/orm-postgres/serverless";
import postgresServerless from "@prisma/orm-postgres/serverless";

/** The serverless client shape for the shared contract. */
type UsersClient = PostgresServerlessClient<Contract>;

/** This request's runtime: what executes a built plan, and the thing `await using` disposes. */
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

/** The one users client, built on first use and reused for its lifetime. */
export function usersClient(): UsersClient {
  client ??= postgresServerless<Contract>({ contractJson, extensions: [geographyRuntimeDescriptor] });
  return client;
}

/** Acquire this request's runtime. The caller disposes it on scope exit. */
export function acquireUsersRuntime(url: string): Promise<UsersRuntime> {
  return usersClient().connect({ url });
}

/** Pair the shared builder with one request's runtime. */
export function usersPrisma(runtime: UsersRuntime): UsersPrisma {
  return {
    builder: usersClient().sql,
    executor: runtime,
    transaction: (fn) => withTransaction(runtime, (tx) => fn(tx)),
  };
}
