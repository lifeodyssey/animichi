import { afterEach, describe, expect, it } from "vitest";
import type { Miniflare } from "miniflare";
import { revision } from "./preflight-fixtures";
import { selectedWorker } from "./selected-workerd";
import { pinsSuiteBudget } from "./suite-budget-pin";
import { WORKERD_BOOT_BUDGET_MS } from "./test-timeout-budget";
import { selectedTransport, type SelectedLedger } from "./selected-neon-transport";

let runtime: Miniflare | undefined;
afterEach(async () => { await runtime?.dispose(); });

// Each test here esbuilds the Worker and boots a Miniflare workerd runtime;
// that wait is budgeted at the suite, not package-wide (#1594).
describe("concurrent selected migrations", { timeout: WORKERD_BOOT_BUDGET_MS }, () => {
  pinsSuiteBudget(WORKERD_BOOT_BUDGET_MS);

  it("validates the queued apply after the first request records an incomplete revision", async () => {
    const db: SelectedLedger = { rows: [revision()], statements: [], headers: [], failNextTransaction: true };
    const worker = await selectedWorker(selectedTransport(db));
    runtime = worker.runtime;
    const responses = await Promise.all([worker.request(), worker.request()].map(async (pending) => {
      const response = await pending;
      return { status: response.status, body: await response.json() };
    }));
    expect(responses.map(({ status }) => status).sort()).toEqual([422, 500]);
    const bodies = responses.map(({ body }) => body);
    expect(bodies).toEqual(expect.arrayContaining([expect.objectContaining({ error: "incomplete_revision" })]));
    expect(JSON.stringify(bodies)).not.toContain("password=fixture");
  });
});
