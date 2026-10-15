import assert from "node:assert/strict";
import test from "node:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core/harness/context";
import type { Session } from "@earendil-works/pi-agent-core/harness/session";
import type { JsonObject } from "@earendil-works/pi-ai";
import { planRoute } from "@animichi/agent/tools";
import { executeTool, fixture } from "./native-tool-fixture.ts";

const IDS = ["point-01", "point-02", "point-03"] as const;
const POINTS = IDS.map((id, index) => ({ id, name: `Stop ${String(index + 1)}`,
  bangumi_id: "123", screenshot_url: "", latitude: 35 + index / 100, longitude: 139 }));

function itinerary(points: typeof POINTS) {
  return { ordered_points: points, point_count: points.length,
    timed_itinerary: { stops: [], legs: [], total_minutes: 480, total_distance_m: 0, pacing: "normal" } };
}

function seed(session: Session, toolName: string, details: JsonObject, isError = false) {
  return session.createBranch("main", null, BACKGROUND_CONTEXT).then((branch) => branch.appendMessage({ role: "toolResult",
    toolCallId: "seed", toolName, timestamp: 0, isError, content: [], details }, BACKGROUND_CONTEXT));
}

function routeDetails() {
  return { itinerary: itinerary(POINTS), source_ref: "seed" };
}

async function planWithSeed(seedFor: (session: Session) => Promise<string>, args: (ref: string) => JsonObject, reply = itinerary(POINTS)) {
  const requests: Request[] = [];
  const { repo, session, toolContext } = await fixture((request) => { requests.push(request); return Promise.resolve(Response.json(reply)); });
  const ref = await seedFor(session);
  const { message } = await executeTool(toolContext, "plan_route", args(ref), [planRoute]);
  await repo.close(BACKGROUND_CONTEXT);
  return { message, requests };
}

const routeSeed = (session: Session) => seed(session, "plan_route", routeDetails());

void test("plan_route without a search or itinerary reference is refused before any catalog call", async () => {
  const { message, requests } = await planWithSeed(routeSeed, () => ({ pacing: "normal" }));
  assert.deepEqual(message.details, { status: "stale_ref" });
  assert.equal(requests.length, 0);
});

void test("plan_route with stop ids on a search reference is refused before any catalog call", async () => {
  const searchSeed = (session: Session) => seed(session, "search_bangumi", { kind: "bangumi", anime_id: "123", rows: POINTS, partial: false });
  const { message, requests } = await planWithSeed(searchSeed, (ref) => ({ search_result_ref: ref, stop_ids: [IDS[0]] }));
  assert.deepEqual(message.details, { status: "stale_ref" });
  assert.equal(requests.length, 0);
});

void test("plan_route naming both an itinerary and a search reference is refused before any catalog call", async () => {
  const { message, requests } = await planWithSeed(routeSeed, (ref) => ({ itinerary_ref: ref, search_result_ref: ref, stop_ids: [IDS[0]] }));
  assert.deepEqual(message.details, { status: "stale_ref" });
  assert.equal(requests.length, 0);
});

void test("plan_route with an empty stop subset is refused before any catalog call", async () => {
  const { message, requests } = await planWithSeed(routeSeed, (ref) => ({ itinerary_ref: ref, stop_ids: [] }));
  assert.deepEqual(message.details, { status: "stale_ref" });
  assert.equal(requests.length, 0);
});

void test("plan_route on a failed earlier route result is refused before any catalog call", async () => {
  const failedSeed = (session: Session) => seed(session, "plan_route", routeDetails(), true);
  const { message, requests } = await planWithSeed(failedSeed, (ref) => ({ itinerary_ref: ref, stop_ids: [IDS[0]] }));
  assert.deepEqual(message.details, { status: "stale_ref" });
  assert.equal(requests.length, 0);
});

void test("plan_route on an earlier route result without an itinerary is refused before any catalog call", async () => {
  const malformedSeed = (session: Session) => seed(session, "plan_route", { source_ref: "seed" });
  const { message, requests } = await planWithSeed(malformedSeed, (ref) => ({ itinerary_ref: ref, stop_ids: [IDS[0]] }));
  assert.deepEqual(message.details, { status: "stale_ref" });
  assert.equal(requests.length, 0);
});

void test("plan_route re-routes a subset of an earlier route that was never frozen", async () => {
  const { message, requests } = await planWithSeed(routeSeed, (ref) => ({ itinerary_ref: ref, stop_ids: [IDS[0], IDS[2]] }),
    itinerary(POINTS.filter((_point, index) => index !== 1)));
  assert.equal(message.isError, false);
  assert.equal(requests.length, 1);
});

void test("plan_route fails a subset route when the catalog returns a stop the earlier route did not offer", async () => {
  const moved = POINTS.map((point) => ({ ...point, latitude: point.latitude + 1 }));
  const { message, requests } = await planWithSeed(routeSeed, (ref) => ({ itinerary_ref: ref, stop_ids: [...IDS] }), itinerary(moved));
  assert.equal(message.isError, true);
  assert.equal(requests.length, 1);
});

void test("plan_route on a search still syncing reports pending_sync before any catalog call", async () => {
  const partialSeed = (session: Session) => seed(session, "search_bangumi", { kind: "bangumi", anime_id: "123", rows: POINTS, partial: true });
  const { message, requests } = await planWithSeed(partialSeed, (ref) => ({ search_result_ref: ref }));
  assert.deepEqual(message.details, { status: "pending_sync" });
  assert.equal(requests.length, 0);
});

void test("plan_route on a search with no rows reports empty before any catalog call", async () => {
  const emptySeed = (session: Session) => seed(session, "search_bangumi", { kind: "bangumi", anime_id: "123", rows: [], partial: false });
  const { message, requests } = await planWithSeed(emptySeed, (ref) => ({ search_result_ref: ref }));
  assert.deepEqual(message.details, { status: "empty" });
  assert.equal(requests.length, 0);
});

void test("plan_route on an itinerary reference without stop ids is refused before any catalog call", async () => {
  const { message, requests } = await planWithSeed(routeSeed, (ref) => ({ itinerary_ref: ref }));
  assert.deepEqual(message.details, { status: "stale_ref" });
  assert.equal(requests.length, 0);
});

void test("plan_route reports an empty route when the catalog plans no stops", async () => {
  const searchSeed = (session: Session) => seed(session, "search_bangumi", { kind: "bangumi", anime_id: "123", rows: POINTS, partial: false });
  const { message } = await planWithSeed(searchSeed, (ref) => ({ search_result_ref: ref }), itinerary([]));
  assert.match(JSON.stringify(message.content), /\\"status\\":\\"empty\\"/);
});

void test("plan_route refuses a subset route when the catalog drops a requested stop", async () => {
  const { message, requests } = await planWithSeed(routeSeed, (ref) => ({ itinerary_ref: ref, stop_ids: [IDS[0], IDS[2]] }),
    itinerary(POINTS.slice(0, 1)));
  assert.deepEqual(message.details, { status: "stale_ref" });
  assert.equal(requests.length, 1);
});
