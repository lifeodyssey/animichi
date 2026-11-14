import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Budget } from "../src/ingest/budgets";
import { ingestRunWork } from "../src/ingest/run-ingest";
import { unreachableCatalogPrisma } from "./fakes/fake-catalog-prisma";
import { unanswered } from "./fakes/unanswered-request";
import type { BudgetLimits } from "../src/ingest/budgets";

/** The seam is never reached: every case returns before the run's database writes. */
const seam = unreachableCatalogPrisma();

/** No case may reach a real upstream: an unscripted fetch fails the case instead of leaving the machine. */
function noNetwork(input: unknown): Promise<Response> {
  return Promise.reject(new Error(`a test reached for the network: ${String(input)}`));
}

beforeEach(() => {
  vi.stubGlobal("fetch", noNetwork);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ingestRunWork budget boundary (AC1)", () => {
  it("returns exhausted instead of throwing when the work no longer fits the budget", async () => {
    // One request remains but a work needs two (fetch bangumi + anitabi).
    const budget = new Budget(budgetLimits({ requestLimit: 3 }));
    budget.spend({ work: 0, requests: 2, runtimeMs: 0 });
    const outcome = await ingestRunWork(seam, "1", "daily-x", budget);
    expect(outcome).toEqual({ outcome: "exhausted" });
  });

  it("does not consume a budget it cannot spend", async () => {
    const budget = new Budget(budgetLimits({ requestLimit: 3 }));
    budget.spend({ work: 0, requests: 2, runtimeMs: 0 });
    await ingestRunWork(seam, "1", "daily-x", budget);
    expect(budget.usage().requestUsed).toBe(2);
  });
});

describe("ingestRunWork against the pass's deadline", () => {
  it("starts no work, and spends nothing, once the pass's deadline has passed", async () => {
    const budget = new Budget(budgetLimits({}));
    const outcome = await ingestRunWork(seam, "1", "daily-x", budget, { signal: AbortSignal.abort() });
    expect(outcome).toEqual({ outcome: "exhausted" });
    expect(budget.usage().requestUsed).toBe(0);
  });

  it("stops at a fetch the deadline cut off instead of tallying it against the source", async () => {
    const pass = new AbortController();
    vi.stubGlobal("fetch", (_input: unknown, init?: RequestInit) => {
      pass.abort(new DOMException("The operation timed out.", "TimeoutError"));
      return unanswered<Response>(init?.signal ?? new AbortController().signal);
    });
    const outcome = await ingestRunWork(seam, "1", "daily-x", new Budget(budgetLimits({})), { signal: pass.signal });
    expect(outcome).toEqual({ outcome: "exhausted" });
  });
});

function budgetLimits(overrides: Partial<BudgetLimits>): BudgetLimits {
  return { workLimit: 10, requestLimit: 20, runtimeLimitMs: 600000, ...overrides };
}
