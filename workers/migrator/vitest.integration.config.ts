import { defineConfig } from "vitest/config";
import unitConfig from "./vitest.config";
import { CONTAINER_MIGRATION_BUDGET_MS } from "./test/test-timeout-budget";

// Package-wide here, deliberately (#1594): every file in this arm provisions
// its own PostgreSQL container and migrates a database inside the test body,
// so there is no plain-node test left to keep on the tight default. The
// number and its measurements live in test/test-timeout-budget.ts.
export default defineConfig({ ...unitConfig,
  test: { ...unitConfig.test, include: ["test/integration/*.integration.ts"], fileParallelism: false,
    testTimeout: CONTAINER_MIGRATION_BUDGET_MS },
});
