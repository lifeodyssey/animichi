/**
 * W1-4 (#1253): `plan_route`, ported from
 * `catalog_route_tools.py::run_itinerary`.
 *
 * The ref is the whole point of this tool's contract: it routes EXACTLY the
 * stored result the model named, and refuses — with a distinct status per
 * reason — rather than falling back to the newest one.
 *
 * test-type: unit (no network, no clock, no bindings).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { planRouteTool } from "../src/agent/tools/plan-route-tool.ts";
import { searchBangumiTool } from "../src/agent/tools/search-bangumi-tool.ts";
import { LUCKY_STAR_ROUTE, SATTE, WASHINOMIYA } from "./doubles/catalog-payloads.ts";
import { unspentBudget } from "./doubles/make-tool-budget.ts";
import { makeCatalogToolSession } from "./doubles/make-catalog-tool-session.ts";
import type { RecordingToolSession } from "./doubles/make-catalog-tool-session.ts";
import { scriptedCatalog } from "./doubles/scripted-catalog.ts";
import type { CatalogScript } from "./doubles/scripted-catalog.ts";

const SYNCED = "2026-06-20T00:00:00.000Z";
const TWO_POINTS = { rows: [WASHINOMIYA, SATTE], synced_at: SYNCED };

/** Store one search result the way `search_bangumi` would, and report its ref. */
async function storedSearch(session: RecordingToolSession, partial: boolean): Promise<string> {
  const { catalog } = scriptedCatalog({ points: { ...TWO_POINTS, partial } });
  const result = await searchBangumiTool(catalog, session, unspentBudget).execute("call-1", { bangumi_id: "1" });
  return (result.details as { result_ref?: string }).result_ref ?? "";
}

/** Run `plan_route` over a scripted catalog against one stored ref. */
async function planRoute(script: CatalogScript, ref: string, session: RecordingToolSession, pacing?: "chill") {
  const { catalog, calls } = scriptedCatalog(script);
  const result = await planRouteTool(catalog, session, unspentBudget).execute("call-2", {
    search_result_ref: ref,
    pacing,
  });
  return { outcome: result.details, calls, session };
}

void test("a stored result is routed and its route stored under its own ref", async () => {
  const session = makeCatalogToolSession();
  const ref = await storedSearch(session, false);
  const { outcome, calls } = await planRoute({ itinerary: LUCKY_STAR_ROUTE }, ref, session, "chill");
  assert.deepEqual(outcome, {
    status: "ok",
    itinerary_ref: "route:2:2",
    point_count: 2,
    total_minutes: 120,
  });
  assert.deepEqual(calls.planned, [{ pointIds: ["spot-1", "spot-2"], pacing: "chill" }]);
});

void test("the stored route carries the summary the web renders above it", async () => {
  const session = makeCatalogToolSession();
  const ref = await storedSearch(session, false);
  await planRoute({ itinerary: LUCKY_STAR_ROUTE }, ref, session);
  assert.deepEqual(session.itineraries.map((stored) => stored.summary), [
    {
      point_count: 2,
      total_minutes: 120,
      total_distance_m: 4_200,
      clusters: 2,
      with_coordinates: 2,
      without_coordinates: 0,
    },
  ]);
  assert.deepEqual(session.itineraries.map((stored) => stored.source_ref), [ref]);
});

void test("a ref this session never minted is stale, and nothing is planned", async () => {
  const session = makeCatalogToolSession();
  const { outcome, calls } = await planRoute({ itinerary: LUCKY_STAR_ROUTE }, "search:9:9", session);
  assert.deepEqual(outcome, { status: "stale_ref" });
  assert.deepEqual(calls.planned, []);
});

void test("a partial result is pending sync, not routed as if it were whole", async () => {
  const session = makeCatalogToolSession();
  const ref = await storedSearch(session, true);
  const { outcome, calls } = await planRoute({ itinerary: LUCKY_STAR_ROUTE }, ref, session);
  assert.deepEqual(outcome, { status: "pending_sync" });
  assert.deepEqual(calls.planned, []);
});

void test("an empty stored result has nothing to route", async () => {
  const session = makeCatalogToolSession();
  const { catalog } = scriptedCatalog({ points: { rows: [], synced_at: SYNCED } });
  await searchBangumiTool(catalog, session, unspentBudget).execute("call-1", { bangumi_id: "999" });
  const { outcome } = await planRoute({ itinerary: LUCKY_STAR_ROUTE }, "search:0:1", session);
  assert.deepEqual(outcome, { status: "empty" });
});

void test("a route the catalog returns with no points is empty, not ok", async () => {
  const session = makeCatalogToolSession();
  const ref = await storedSearch(session, false);
  const emptied = { ...LUCKY_STAR_ROUTE, ordered_points: [], point_count: 0 };
  const { outcome } = await planRoute({ itinerary: emptied }, ref, session);
  assert.deepEqual(outcome, { status: "empty" });
});

void test("an unreachable catalog degrades the route request", async () => {
  const session = makeCatalogToolSession();
  const ref = await storedSearch(session, false);
  const { outcome } = await planRoute({}, ref, session);
  assert.deepEqual(outcome, { status: "upstream_unavailable" });
});
