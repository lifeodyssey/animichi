import assert from "node:assert/strict";
import test from "node:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core/harness/context";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { Itinerary } from "@animichi/contract/models";
import { z } from "zod";
import { catalogPostgres } from "./catalog-postgres.ts";
import { catalogWorker } from "./catalog-worker.ts";
import { catalogHarness, latestTool } from "./catalog-harness.ts";
import { seedSubsetCatalog } from "./catalog-seed.ts";

void test("a two-turn session re-routes the remaining stops of an earlier route without a new search or full re-plan", { timeout: 360_000 }, async (context) => {
  const database = await catalogPostgres(context);
  await seedSubsetCatalog(database.sql);
  const address = await catalogWorker(context, database.connectionString, database.endpoint);
  const { lane, provider, requests, itineraries } = await catalogHarness(context, address);

  provider.setResponses([
    fauxAssistantMessage(fauxToolCall("search_bangumi", { bangumi_id: "1557" }), { stopReason: "toolUse" }),
    fauxAssistantMessage("Found the points."),
  ]);
  await lane.prompt("Find the pilgrimage points", undefined, BACKGROUND_CONTEXT);
  const search = await latestTool(lane, "search_bangumi");

  provider.setResponses([
    fauxAssistantMessage(fauxToolCall("plan_route", { search_result_ref: search.id }), { stopReason: "toolUse" }),
    fauxAssistantMessage("Route planned."),
  ]);
  await lane.prompt("Plan a route over every stop", undefined, BACKGROUND_CONTEXT);
  const route = await latestTool(lane, "plan_route");
  const first = z.object({ itinerary: Itinerary }).parse(route.message.details);
  const ids = first.itinerary.ordered_points.map((point) => point.id);
  assert.equal(ids.length, 12);

  const before = requests.length, beforeItineraries = itineraries.length;
  const remaining = ids.filter((_id, index) => index !== 1);
  provider.setResponses([
    fauxAssistantMessage(fauxToolCall("plan_route", { itinerary_ref: route.id, stop_ids: remaining }), { stopReason: "toolUse" }),
    fauxAssistantMessage("Skipped the second stop."),
  ]);
  await lane.prompt("Skip the second stop", undefined, BACKGROUND_CONTEXT);

  assert.deepEqual(requests.slice(before), ["/catalog/itinerary"]);
  assert.equal(itineraries.length, beforeItineraries + 1);
  assert.deepEqual((itineraries.at(-1) as { point_ids: string[] }).point_ids, remaining);
  const subset = z.object({ itinerary: Itinerary }).parse((await latestTool(lane, "plan_route")).message.details);
  assert.deepEqual([...subset.itinerary.ordered_points.map((point) => point.id)].sort(), [...remaining].sort());
});
