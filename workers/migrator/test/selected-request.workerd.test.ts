import { afterEach, describe, expect, it } from "vitest";
import { Response as WorkerResponse } from "miniflare";
import { metadata } from "./preflight-fixtures";
import { selectedWorker } from "./selected-workerd";
import { pinsSuiteBudget } from "./suite-budget-pin";
import { WORKERD_BOOT_BUDGET_MS } from "./test-timeout-budget";

// What the DEPLOYED entry decides before it can reach a database at all: identity, the
// staging-only refusal, the request bound, and the bundle handshake. The runtime carries no
// migration graph at `/bundle/migrations`, so a request that passes every boundary answers
// `409 stale_prisma_bundle` — which is itself the assertion that it got that far. Applying
// against a real graph and a real database is `test/integration/prisma.workerd.integration.ts`.

let runtime: Awaited<ReturnType<typeof selectedWorker>>["runtime"] | undefined;
afterEach(async () => { await runtime?.dispose(); });
const production = { environment: undefined, sub: "repo:lifeodyssey/animichi:environment:production" };

/** Every outbound call this suite does not expect: reaching it at all is the failure. */
function noOutboundCalls() {
  const calls: string[] = [];
  const transport = (request: { url: string }) => {
    calls.push(request.url);
    return Promise.resolve(WorkerResponse.json({}, { status: 500 }));
  };
  return { transport, calls };
}

// Each test here esbuilds the Worker and boots a Miniflare workerd runtime;
// that wait is budgeted at the suite, not package-wide (#1594).
describe("selected apply request boundaries", { timeout: WORKERD_BOOT_BUDGET_MS }, () => {
  pinsSuiteBudget(WORKERD_BOOT_BUDGET_MS);

  it("keeps legitimate production subjects without an environment claim", async () => {
    const worker = await selectedWorker(noOutboundCalls().transport, production, "production");
    runtime = worker.runtime;
    const response = await worker.request();
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "stale_prisma_bundle" });
  });

  it("requires main independently of the production environment subject", async () => {
    const outbound = noOutboundCalls();
    const worker = await selectedWorker(outbound.transport, { ...production, ref: "refs/heads/feature" }, "production");
    runtime = worker.runtime;
    const response = await worker.request();
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "forbidden" });
    expect(outbound.calls).toEqual([]);
  });

  it("refuses a production staging-only baseline before the bundle handshake", async () => {
    const outbound = noOutboundCalls();
    const worker = await selectedWorker(outbound.transport, production, "production");
    runtime = worker.runtime;
    const response = await worker.request("/migrate", { ...metadata, stagingOnlyBaseline: true });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: "staging_only_baseline" });
    expect(outbound.calls).toEqual([]);
  });

  it("bounds the authenticated request body using Hono", async () => {
    const outbound = noOutboundCalls();
    const worker = await selectedWorker(outbound.transport);
    runtime = worker.runtime;
    const response = await worker.request("/migrate", { ...metadata, padding: "a".repeat(65_536) });
    expect(response.status).toBe(413);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: "invalid_migration" });
    expect(outbound.calls).toEqual([]);
  });
});
