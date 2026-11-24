import { beforeEach, expect, it, vi } from "vitest";

// SUT: `planContract()` in `src/db/plan-contract.ts`, where the plan repairs in `src/db/plans.ts`
// read the shared contract. `src/db/prisma.ts` records it as it evaluates, and that module loads on
// the first request that needs it, so a repair that ran before it would have no contract. It is
// refused by name rather than handed `undefined` for `planFromAst` to read the target from.
//
// What is recorded is module state, so the test imports a FRESH copy of the module
// (`vi.resetModules`), as `prisma-connection.worker.test.ts` does: nothing in this copy's graph has
// recorded a contract.

/** The plan-contract module under test, freshly instantiated for this test. */
async function planContractModule(): Promise<typeof import("../src/db/plan-contract")> {
  return await import("../src/db/plan-contract");
}

beforeEach(() => {
  vi.resetModules();
});

it("refuses a plan repair by name while no contract is recorded", async () => {
  const { planContract } = await planContractModule();
  expect(() => planContract()).toThrow("plan repair before the catalog's Prisma access loaded: no contract");
});
