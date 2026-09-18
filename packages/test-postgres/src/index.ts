/**
 * @animichi/test-postgres — the shared test-only Postgres data plane.
 *
 * Test surfaces only: nothing under any `src/` that reaches a Worker bundle
 * may import this package (`test/never-bundled.test.ts` is the tripwire).
 */

export { OFFLINE_POSTGRES_IMAGE } from "./postgres-image.ts";
export { ChainApplyTurn } from "./chain-apply-turn.ts";
export { applyPrismaChain } from "./prisma-chain.ts";
export { assertServiceRoles, createServiceRoles, SERVICE_ROLES } from "./service-roles.ts";
export { createCleanDatabase, dropCleanDatabase } from "./clean-database.ts";
export { applyDrizzleEraCatalog } from "./drizzle-era-catalog.ts";
export { uniqueDatabaseName } from "./database-name.ts";
export {
  isStartingUp,
  PostgresStartupWait,
  type Pause,
  type StartupWaitLimits,
} from "./postgres-startup-wait.ts";
export {
  AGENT_DB_SETUP_BUDGET,
  hookTimeoutMs,
  SPIKE_SETUP_BUDGET,
  type SetupBudget,
} from "./setup-budget.ts";
export { SetupDeadline } from "./setup-deadline.ts";
export {
  clusterAdminDsn,
  POSTGRES_PASSWORD,
  POSTGRES_USER,
  startTestPostgresCluster,
  type TestPostgresCluster,
  type TestPostgresClusterRequest,
} from "./test-postgres-cluster.ts";
export { startTestPostgres, type TestPostgres, type TestPostgresRequest } from "./test-postgres.ts";
