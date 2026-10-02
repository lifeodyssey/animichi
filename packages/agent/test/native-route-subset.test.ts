import assert from "node:assert/strict";
import test from "node:test";
import { getOrThrow } from "@earendil-works/pi-agent-core";
import { BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core/harness/context";
import type { Entry } from "@earendil-works/pi-agent-core/harness/session";
import { createModels, fauxAssistantMessage, fauxProvider, fauxToolCall, type Message } from "@earendil-works/pi-ai";
import { createPilgrimageHarness } from "@animichi/agent/harness";
import { planRoute } from "@animichi/agent/tools";
import { executeTool, fixture } from "./native-tool-fixture.ts";

const POINTS = Array.from({ length: 12 }, (_unused, index) => ({ id: `point-${String(index + 1).padStart(2, "0")}`,
  name: `Stop ${String(index + 1)}`, bangumi_id: "123", screenshot_url: "", latitude: 35 + index / 100, longitude: 139 }));
const IDS = POINTS.map((point) => point.id);
const BY_ID = new Map(POINTS.map((point) => [point.id, point]));

function idAt(index: number) {
  const id = IDS[index]; assert.ok(id); return id;
}

function pointsFor(ids: readonly string[]) {
  return ids.map((id) => { const point = BY_ID.get(id); assert.ok(point); return point; });
}

function itinerary(ids: readonly string[]) {
  return { ordered_points: pointsFor(ids), point_count: ids.length,
    timed_itinerary: { stops: [], legs: [], total_minutes: 480, total_distance_m: 0, pacing: "normal" } };
}

function routeEntry(ids: readonly string[], frozenSummary?: string) {
  return { itinerary: itinerary(ids), source_ref: "seed",
    ...(frozenSummary === undefined ? {} : { frozenSummary }) };
}

function published(ids: readonly string[]) {
  return `[plan_route: itinerary_ref=placeholder, ordered_stops=${JSON.stringify(ids)}]`;
}

function toolTexts(messages: readonly Message[]) {
  return messages.flatMap((message) => message.role === "toolResult"
    ? message.content.flatMap((part) => part.type === "text" ? [part.text] : []) : []);
}

function isRouteResult(entry: Entry): boolean {
  return entry.type === "message" && entry.message.role === "toolResult" && entry.message.toolName === "plan_route";
}

void test("an ordinal follow-up re-routes exactly the published remaining stops in route order", async () => {
  const bodies: string[] = [];
  const { repo, session, toolContext } = await fixture((request) => request.json().then((body: { point_ids: string[] }) => {
    bodies.push(JSON.stringify(body.point_ids));
    return Response.json(itinerary(body.point_ids));
  }));
  const branch = await session.createBranch("main", null, BACKGROUND_CONTEXT);
  const ref = await branch.appendMessage({ role: "toolResult", toolCallId: "seed", toolName: "search_bangumi", timestamp: 0,
    isError: false, content: [], details: { kind: "bangumi", anime_id: "123", rows: POINTS, partial: false } }, BACKGROUND_CONTEXT);
  const provider = fauxProvider();
  provider.setResponses([
    fauxAssistantMessage(fauxToolCall("plan_route", { search_result_ref: ref }), { stopReason: "toolUse" }),
    fauxAssistantMessage("Route ready."),
    (context) => {
      const summary = toolTexts(context.messages).find((text) => text.startsWith("[plan_route:"));
      assert.ok(summary);
      const itineraryRef = /itinerary_ref=([^,]+)/.exec(summary)?.[1];
      assert.ok(itineraryRef);
      const ids = JSON.parse(/ordered_stops=(\[.*?\])/.exec(summary)?.[1] ?? "[]") as string[];
      return fauxAssistantMessage(fauxToolCall("plan_route", { itinerary_ref: itineraryRef,
        stop_ids: ids.filter((_id, index) => index !== 1) }), { stopReason: "toolUse" });
    },
    fauxAssistantMessage("Skipped the second stop."),
  ]);
  const models = createModels(); models.setProvider(provider.provider);
  const { harness } = await createPilgrimageHarness({ session, toolContext, models, model: provider.getModel() }, BACKGROUND_CONTEXT);
  try {
    const lane = await harness.lane("main", BACKGROUND_CONTEXT);
    getOrThrow(await lane.prompt("Plan a route", undefined, BACKGROUND_CONTEXT));
    getOrThrow(await lane.prompt("Skip the second stop", undefined, BACKGROUND_CONTEXT));
    const remaining = IDS.filter((_id, index) => index !== 1);
    assert.deepEqual(bodies, [JSON.stringify(IDS), JSON.stringify(remaining)]);
    const route = [...await lane.findEntries({ type: "message" }, BACKGROUND_CONTEXT)].sort((left, right) => left.seq - right.seq)
      .filter(isRouteResult).at(-1);
    assert.ok(route?.type === "message" && route.message.role === "toolResult");
    const text = route.message.content.find((part) => part.type === "text")?.text ?? "";
    assert.deepEqual((JSON.parse(text) as { ordered_point_ids: string[] }).ordered_point_ids, remaining);
  } finally { await harness.close(BACKGROUND_CONTEXT); await repo.close(BACKGROUND_CONTEXT); }
});

void test("a stop id the earlier route never published is refused before any catalog call", async () => {
  const requests: Request[] = [];
  const { repo, session, toolContext } = await fixture((request) => { requests.push(request); return Promise.resolve(Response.json(itinerary(IDS))); });
  const branch = await session.createBranch("main", null, BACKGROUND_CONTEXT);
  const ref = await branch.appendMessage({ role: "toolResult", toolCallId: "route", toolName: "plan_route", timestamp: 0,
    isError: false, content: [], details: routeEntry(IDS, published(IDS)) }, BACKGROUND_CONTEXT);
  const { message } = await executeTool(toolContext, "plan_route", { itinerary_ref: ref, stop_ids: [idAt(0), "invented"] }, [planRoute]);
  assert.deepEqual(message.details, { status: "stale_ref" });
  assert.equal(requests.length, 0);
  await repo.close(BACKGROUND_CONTEXT);
});

void test("a stale or unknown route reference is refused before any catalog call", async () => {
  for (const kind of ["unknown", "non-route"] as const) {
    const requests: Request[] = [];
    const { repo, session, toolContext } = await fixture((request) => { requests.push(request); return Promise.resolve(Response.json(itinerary(IDS))); });
    const branch = await session.createBranch("main", null, BACKGROUND_CONTEXT);
    const itineraryRef = kind === "unknown" ? "unknown" : await branch.appendMessage({ role: "toolResult", toolCallId: "search",
      toolName: "search_bangumi", timestamp: 0, isError: false, content: [],
      details: { kind: "bangumi", anime_id: "123", rows: POINTS, partial: false } }, BACKGROUND_CONTEXT);
    const { message } = await executeTool(toolContext, "plan_route", { itinerary_ref: itineraryRef, stop_ids: [idAt(0)] }, [planRoute]);
    assert.deepEqual(message.details, { status: "stale_ref" });
    assert.equal(requests.length, 0);
    await repo.close(BACKGROUND_CONTEXT);
  }
});

void test("a frozen route summary that lost the ordered ids is refused", async () => {
  const requests: Request[] = [];
  const { repo, session, toolContext } = await fixture((request) => { requests.push(request); return Promise.resolve(Response.json(itinerary(IDS))); });
  const branch = await session.createBranch("main", null, BACKGROUND_CONTEXT);
  const ref = await branch.appendMessage({ role: "toolResult", toolCallId: "route", toolName: "plan_route", timestamp: 0,
    isError: false, content: [], details: routeEntry(IDS, "[plan_route: itinerary_ref=placeholder, total_minutes=480]") }, BACKGROUND_CONTEXT);
  const { message } = await executeTool(toolContext, "plan_route", { itinerary_ref: ref, stop_ids: [idAt(0)] }, [planRoute]);
  assert.deepEqual(message.details, { status: "stale_ref" });
  assert.equal(requests.length, 0);
  await repo.close(BACKGROUND_CONTEXT);
});

void test("a subset request keeps the earlier route's order regardless of the order named", async () => {
  const bodies: string[] = [];
  const { repo, session, toolContext } = await fixture((request) => request.json().then((body: { point_ids: string[] }) => {
    bodies.push(JSON.stringify(body.point_ids));
    return Response.json(itinerary(body.point_ids));
  }));
  const branch = await session.createBranch("main", null, BACKGROUND_CONTEXT);
  const ref = await branch.appendMessage({ role: "toolResult", toolCallId: "route", toolName: "plan_route", timestamp: 0,
    isError: false, content: [], details: routeEntry(IDS, published(IDS)) }, BACKGROUND_CONTEXT);
  const { message } = await executeTool(toolContext, "plan_route", { itinerary_ref: ref, stop_ids: [idAt(5), idAt(0)] }, [planRoute]);
  assert.equal(message.isError, false);
  assert.deepEqual(bodies, [JSON.stringify([idAt(0), idAt(5)])]);
  await repo.close(BACKGROUND_CONTEXT);
});
