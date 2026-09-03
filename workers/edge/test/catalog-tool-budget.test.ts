/**
 * W1-4 (#1253): the outermost rung of the timeout ladder — the per-tool
 * deadline Python got from pydantic-ai (`Tool(timeout=85)`,
 * `animichi_tools.py::TOOLS`) and pi does not provide.
 *
 * The clock is not real: the budget is a `ToolBudget` the test supplies, so
 * "already elapsed" is a signal that is already aborted rather than 85 seconds
 * of waiting. The distinction that matters is which failure the model sees and
 * which one ends the turn.
 *
 * test-type: unit (no network, no real clock, no bindings).
 */
import test from "node:test";
import assert from "node:assert/strict";
import type { CatalogClient } from "../src/agent/tools/catalog-client.ts";
import { catalogToolbox } from "../src/agent/tools/catalog-toolbox.ts";
import { makeCatalogToolSession } from "./doubles/make-catalog-tool-session.ts";
import { spentBudget, unspentBudget } from "./doubles/make-tool-budget.ts";
import { scriptedCatalog } from "./doubles/scripted-catalog.ts";

/** A catalog that holds every call until the deadline it was handed aborts.
 * `throwIfAborted` first, mirroring the real adapter: a deadline that elapsed
 * before the call was made never fires an `abort` event to listen for. */
function holdingCatalog(): CatalogClient {
  const hold = async (signal?: AbortSignal): Promise<never> => {
    signal?.throwIfAborted();
    return new Promise((_resolve, reject) => {
      signal?.addEventListener("abort", () => {
        reject(signal.reason as Error);
      });
    });
  };
  return {
    resolve: (_query, signal) => hold(signal),
    pointsByBangumiId: (_id, signal) => hold(signal),
    nearby: (_around, _radiusM, signal) => hold(signal),
    geocode: (_query, _limit, signal) => hold(signal),
    planItinerary: (_ids, _pacing, signal) => hold(signal),
  };
}

/** `resolve_anime`, built over a catalog that never answers on its own. */
function heldResolve(budget = spentBudget) {
  const [resolveAnime] = catalogToolbox(holdingCatalog(), makeCatalogToolSession(), budget);
  assert.ok(resolveAnime);
  return resolveAnime;
}

void test("a tool whose budget elapses degrades instead of hanging the turn", async () => {
  const result = await heldResolve().execute("call-1", { title: "らき☆すた" });
  assert.deepEqual(result.details, { outcome: "upstream_unavailable" });
});

void test("an aborted TURN is not a tool failure and propagates", async () => {
  const controller = new AbortController();
  const running = heldResolve(unspentBudget).execute("call-1", { title: "らき☆すた" }, controller.signal);
  controller.abort();
  await assert.rejects(() => running);
});

void test("the budget reaches the catalog, not just the tool wrapper", async () => {
  const { catalog, calls } = scriptedCatalog({ resolve: { outcome: "not_found", reason: "anime_not_found" } });
  const [resolveAnime] = catalogToolbox(catalog, makeCatalogToolSession(), unspentBudget);
  assert.ok(resolveAnime);
  await resolveAnime.execute("call-1", { title: "らき☆すた" });
  assert.deepEqual(calls.resolved, ["らき☆すた"]);
});
