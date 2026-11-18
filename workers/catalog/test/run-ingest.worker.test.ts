import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ANITABI_EGRESS_BASE_URL } from "../src/ingest/anitabi-egress";
import { Budget } from "../src/ingest/budgets";
import { ingestRunWork } from "../src/ingest/run-ingest";
import type { AnitabiPoint, UpstreamAccess } from "../src/ingest/sources";
import { stubEgressSigningKey } from "./egress-stub";
import { failingCatalogPrisma, planTable, unreachableCatalogPrisma } from "./fakes/fake-catalog-prisma";
import { recordingCatalogPrisma } from "./fakes/plan-inspection";
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
    budget.spend({ work: 0, requests: 2 });
    const outcome = await ingestRunWork(seam, "1", "daily-x", budget);
    expect(outcome).toEqual({ outcome: "exhausted" });
  });

  it("does not consume a budget it cannot spend", async () => {
    const budget = new Budget(budgetLimits({ requestLimit: 3 }));
    budget.spend({ work: 0, requests: 2 });
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

describe("ingestRunWork's provenance write", () => {
  it("writes a work's provenance in one statement, for one point as for fifty", async () => {
    const one = await provenancePlans(points(1));
    const fifty = await provenancePlans(points(50));
    expect([one.length, fifty.length]).toEqual([1, 1]);
  });

  it("writes the work and each point with a usable id once, skipping a point without one", async () => {
    const plans = await provenancePlans([{ id: "a" }, { id: 7 }, { id: "a" }, { name: "no id" }]);
    expect(boundEntityIds(plans)).toEqual([WORK, "a", "7"]);
  });

  it("rejects with the provenance write's own error rather than reaching enrich", async () => {
    vi.stubGlobal("fetch", upstreamListing(points(3)));
    const refused = new Error("provenance refused");
    const failing = failingCatalogPrisma({ onTable: "catalog_provenance", error: refused });
    await expect(ingestRunWork(failing, WORK, "daily-x", new Budget(budgetLimits({})), access())).rejects.toBe(refused);
  });
});

const WORK = "101";

/** The statements that wrote `catalog_provenance` while one work whose upstream lists `listed` was ingested. */
async function provenancePlans(listed: readonly AnitabiPoint[]): Promise<readonly { readonly ast: unknown }[]> {
  vi.stubGlobal("fetch", upstreamListing(listed));
  const seam = recordingCatalogPrisma();
  await ingestRunWork(seam.query, WORK, "daily-x", new Budget(budgetLimits({})), access());
  return seam.plans().filter((plan) => planTable(plan) === "catalog_provenance");
}

/** The work's upstreams: Bangumi answers its subject, and the egress service relays Anitabi's points. */
function upstreamListing(listed: readonly AnitabiPoint[]): (input: unknown) => Promise<Response> {
  return (input) => Promise.resolve(String(input).startsWith(ANITABI_EGRESS_BASE_URL) ? relayed(listed) : Response.json({ name: "work" }));
}

/** A JSON body as the egress service relays it, under the service's relayed marker. */
function relayed(body: unknown): Response {
  return Response.json(body, { headers: { "x-egress-response": "relayed-upstream" } });
}

function points(count: number): AnitabiPoint[] {
  return Array.from({ length: count }, (_, index) => ({ id: `p-${String(index)}` }));
}

function access(): UpstreamAccess {
  return { egressSigningKey: stubEgressSigningKey() };
}

/** An INSERT plan's rows: each column's bound value. */
interface InsertRows {
  readonly rows: readonly Readonly<Record<string, { readonly value?: unknown }>>[];
}

/** The `entity_id` every row of the given INSERT plans binds, in order. */
function boundEntityIds(plans: readonly { readonly ast: unknown }[]): unknown[] {
  return plans.flatMap((plan) => (plan.ast as InsertRows).rows.map((row) => row.entity_id?.value));
}

function budgetLimits(overrides: Partial<BudgetLimits>): BudgetLimits {
  return { workLimit: 10, requestLimit: 20, ...overrides };
}
