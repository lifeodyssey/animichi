/**
 * @animichi/test-postgres — the shared test-only Postgres data plane.
 *
 * Test surfaces only: nothing under any `src/` that reaches a Worker bundle
 * may import this package (`test/never-bundled.test.ts` is the tripwire).
 */

export { OFFLINE_POSTGRES_IMAGE } from "./postgres-image.ts";
export { applyAtlasChain } from "./atlas-chain.ts";
export { createCleanDatabase } from "./clean-database.ts";
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
  POSTGRES_PASSWORD,
  POSTGRES_USER,
  startTestPostgres,
  type TestPostgres,
  type TestPostgresRequest,
} from "./test-postgres.ts";
