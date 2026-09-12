/** Contract over every vitest config this package ships (#1594).
 *
 * SUT: the configs, not anything under `src/`. Both of the two that exist
 * inherited vitest's implicit 5000 ms `testTimeout`, which is why a cold
 * workerd boot and a container-plus-migration test failed on wall clock. The
 * configs are therefore collected by glob rather than imported one by one: a
 * third config added later is picked up by the same glob on the run that adds
 * it, and has to declare a budget from `test-timeout-budget.ts` instead of
 * silently inheriting 5 s.
 */
import { describe, expect, it } from "vitest";
import type { ViteUserConfig } from "vitest/config";
import { CONTAINER_MIGRATION_BUDGET_MS, DECLARED_BUDGETS_MS, PLAIN_NODE_BUDGET_MS } from "./test-timeout-budget";

/* Every extension Vite will load a config from, not just `.ts`. A review probe
 * added `vitest.slow.config.mts` and this suite stayed green at 7 passed — the
 * config was invisible, which is the exact hole the durable criterion exists to
 * close. Widen the glob rather than trusting a naming habit. */
const shipped = import.meta.glob<{ readonly default: ViteUserConfig }>(
  "../vitest*.config.{ts,mts,cts,js,mjs,cjs}",
  { eager: true },
);

interface ShippedBudget {
  readonly name: string;
  readonly budgetMs: number | undefined;
}

const shippedBudgets: readonly ShippedBudget[] = Object.entries(shipped)
  .map(([path, loaded]) => ({ name: path.slice("../".length), budgetMs: loaded.default.test?.testTimeout }));

const budgetMsOf = new Map(shippedBudgets.map(({ name, budgetMs }) => [name, budgetMs]));

describe.each(shippedBudgets)("$name", ({ budgetMs }) => {
  it("declares a per-test budget instead of inheriting vitest's default", () => {
    expect(typeof budgetMs).toBe("number");
  });

  it("declares one of the budgets test-timeout-budget.ts justifies", () => {
    expect(DECLARED_BUDGETS_MS).toContain(budgetMs);
  });
});

it("keeps the unit arm's package-wide budget at the tight plain-node default", () => {
  expect(budgetMsOf.get("vitest.config.ts")).toBe(PLAIN_NODE_BUDGET_MS);
});

it("gives the integration arm the container-plus-migration budget", () => {
  expect(budgetMsOf.get("vitest.integration.config.ts")).toBe(CONTAINER_MIGRATION_BUDGET_MS);
});

it("runs itself under that tight default", ({ task }) => {
  expect(task.timeout).toBe(PLAIN_NODE_BUDGET_MS);
});
