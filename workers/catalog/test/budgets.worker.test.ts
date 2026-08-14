import { describe, expect, it } from "vitest";
import { Budget, spendRequests, spendRuntime, spendWork } from "../src/ingest/budgets";

const LIMITS = { workLimit: 3, requestLimit: 8, runtimeLimitMs: 1000 };

describe("Budget ledger (AC3)", () => {
  it("reports no exhaustion before any spend", () => {
    const budget = new Budget(LIMITS);
    expect(budget.firstExhausted()).toBeNull();
    expect(budget.workExhausted()).toBe(false);
  });

  it("records work + request + runtime consumption exactly", () => {
    const budget = new Budget(LIMITS);
    spendWork(budget, 2, 5);
    spendRequests(budget, 3);
    expect(budget.usage()).toEqual({
      workUsed: 1,
      requestUsed: 5,
      runtimeUsedMs: 5,
      limits: LIMITS,
    });
  });

  it("flags the work dimension first when it hits the cap", () => {
    const budget = new Budget({ workLimit: 1, requestLimit: 8, runtimeLimitMs: 1000 });
    spendWork(budget, 2, 5);
    expect(budget.workExhausted()).toBe(true);
    expect(budget.firstExhausted()).toBe("work");
  });

  it("throws when a spend would exceed the request cap", () => {
    const budget = new Budget({ workLimit: 10, requestLimit: 2, runtimeLimitMs: 1000 });
    spendRequests(budget, 2);
    expect(() => { spendRequests(budget, 1); }).toThrow("request budget exhausted");
  });

  it("throws when a spend would exceed the runtime cap", () => {
    const budget = new Budget({ workLimit: 10, requestLimit: 10, runtimeLimitMs: 10 });
    expect(() => { spendRuntime(budget, 11); }).toThrow("runtime budget exhausted");
  });

  it("rejects a non-positive limit at construction", () => {
    expect(() => new Budget({ workLimit: 0, requestLimit: 1, runtimeLimitMs: 1 })).toThrow(/workLimit/);
    expect(() => new Budget({ workLimit: 1, requestLimit: 1.5, runtimeLimitMs: 1 })).toThrow(/requestLimit/);
  });

  it("allows the final spend exactly at the cap boundary", () => {
    const budget = new Budget({ workLimit: 2, requestLimit: 8, runtimeLimitMs: 1000 });
    spendWork(budget, 4, 10);
    spendWork(budget, 4, 10);
    expect(budget.usage().workUsed).toBe(2);
  });
});
