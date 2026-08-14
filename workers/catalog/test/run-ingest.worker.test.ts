import { describe, expect, it } from "vitest";
import { Budget } from "../src/ingest/budgets";
import { ingestRunWork } from "../src/ingest/run-ingest";
import type { CatalogDb } from "../src/db/client";
import type { BudgetLimits } from "../src/ingest/budgets";

describe("ingestRunWork budget boundary (AC1)", () => {
  it("returns exhausted instead of throwing when the work no longer fits the budget", async () => {
    // One request remains but a work needs two (fetch bangumi + anitabi).
    const budget = new Budget(budgetLimits({ requestLimit: 3 }));
    budget.spend({ work: 0, requests: 2, runtimeMs: 0 });
    const outcome = await ingestRunWork({} as CatalogDb, "1", "daily-x", budget);
    expect(outcome).toEqual({ outcome: "exhausted" });
  });

  it("does not consume a budget it cannot spend", async () => {
    const budget = new Budget(budgetLimits({ requestLimit: 3 }));
    budget.spend({ work: 0, requests: 2, runtimeMs: 0 });
    await ingestRunWork({} as CatalogDb, "1", "daily-x", budget);
    expect(budget.usage().requestUsed).toBe(2);
  });
});

function budgetLimits(overrides: Partial<BudgetLimits>): BudgetLimits {
  return { workLimit: 10, requestLimit: 20, runtimeLimitMs: 600000, ...overrides };
}
