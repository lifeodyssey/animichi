import { OpenAPIHandler } from "@orpc/openapi/fetch";
import assert from "node:assert/strict";
import { describe, expect, it, vi } from "vitest";
import { planItinerary, type ItineraryObservation, type ItineraryPoint, type PointsForRoutePort } from "../src/application/plan-itinerary";
import { pointsForRoute, type RouteDb } from "../src/adapters/outbound/route-points";
import type { CatalogDb } from "../src/db/client";
import { catalogRouter, type CatalogContext } from "../src/router";

/**
 * Use-case seam tests: `planItinerary` receives points through a fake
 * `PointsForRoutePort` — no DB, no SQL here. Covers orchestration, `Itinerary`
 * assembly, redacted observability, the adapter wiring, and the published
 * `/catalog/itinerary` route seam. Fixture: a/b/c on a meridian, >50m apart
 * (each its own cluster, gaps 111.19 m), bangumi "k" "Lucky Star", image "a.jpg".
 */
function point(id: string, lat: number, image = ""): ItineraryPoint {
  return {
    id, name: id.toUpperCase(), bangumi_id: "k", screenshot_url: image,
    latitude: lat, longitude: 135.0,
    title: "Lucky Star", title_cn: "幸运星", cover_url: "cover.jpg", city: "Tokyo",
  };
}
const POINTS = [point("a", 35.0, "a.jpg"), point("b", 35.001), point("c", 35.002)];
const MANY = Array.from({ length: 51 }, (_, i) => point(`p${String(i).padStart(3, "0")}`, 35 + i * 0.001));
const ids = (ps: ItineraryPoint[]): string[] => ps.map((p) => p.id);
function fakePort(points: ItineraryPoint[]): PointsForRoutePort {
  const byId = new Map(points.map((p) => [p.id, p]));
  return {
    loadPoints: (ps) =>
      Promise.resolve(ps.flatMap((id) => {
        const val = byId.get(id);
        return val ? [val] : [];
      })),
  };
}

describe("planItinerary — deterministic cluster ordering", () => {
  it("plans a timed route with a stop+leg itinerary for the selected ids", async () => {
    const r = await planItinerary(fakePort(POINTS), { point_ids: ["a", "b", "c"], pacing: "normal" });
    expect(r.point_count).toBe(3);
    expect(r.timed_itinerary.stops.map((s) => s.cluster_id)).toEqual(["a", "b", "c"]);
    expect(r.timed_itinerary.legs.map((l) => [l.from_id, l.to_id])).toEqual([["a", "b"], ["b", "c"]]);
    expect(r.timed_itinerary.total_minutes).toBe(28);
    expect(r.timed_itinerary.total_distance_m).toBe(222.4);
  });
  it("ordered_points follow itinerary order (NN from origin near c -> c,b,a)", async () => {
    const r = await planItinerary(fakePort(POINTS), { point_ids: ["a", "b", "c"], origin: { lat: 35.0025, lng: 135.0 } });
    expect(ids(r.ordered_points)).toEqual(["c", "b", "a"]);
    expect(r.timed_itinerary.stops.map((s) => s.cluster_id)).toEqual(["c", "b", "a"]);
  });
  it("ordered_points (no origin) follow the deterministic alphabetical NN seed a,b,c", async () => {
    const r = await planItinerary(fakePort(POINTS), { point_ids: ["c", "a", "b"] });
    expect(ids(r.ordered_points)).toEqual(["a", "b", "c"]);
    expect(r.point_count).toBe(3);
  });
});

describe("planItinerary — assembly, empty ids, and the cluster cap", () => {
  it("carries anime title + cover metadata and point fields from the lead point", async () => {
    const r = await planItinerary(fakePort(POINTS), { point_ids: ["a", "b", "c"] });
    expect(r.anime_title).toBe("Lucky Star");
    expect(r.anime_title_cn).toBe("幸运星");
    expect(r.cover_url).toBe("cover.jpg");
    const [a] = r.ordered_points;
    expect(a?.screenshot_url).toBe("a.jpg");
    expect(a?.city).toBe("Tokyo");
    expect(a?.latitude).toBe(35.0);
  });
  it("unknown ids -> point_count 0 with an empty itinerary", async () => {
    const r = await planItinerary(fakePort(POINTS), { point_ids: ["nope", "missing"] });
    expect(r.point_count).toBe(0);
    expect(r.ordered_points).toEqual([]);
    expect(r.timed_itinerary.stops).toEqual([]);
    expect(r.timed_itinerary.total_minutes).toBe(0);
  });
  it("empty point_ids -> point_count 0 with an empty itinerary", async () => {
    const r = await planItinerary(fakePort(POINTS), { point_ids: [] });
    expect(r.point_count).toBe(0);
    expect(r.ordered_points).toEqual([]);
    expect(r.timed_itinerary.stops).toEqual([]);
  });
  it("caps 51 clusters and discloses the successful truncation", async () => {
    const r = await planItinerary(fakePort(MANY), { point_ids: ids(MANY) });
    expect(r.point_count).toBe(50);
    expect(r.timed_itinerary.stops).toHaveLength(50);
    expect(ids(r.ordered_points)).not.toContain("p050");
    expect(r).toMatchObject({ truncated: true, shown_cluster_count: 50, total_cluster_count: 51 });
  });
  it("keeps the response shape unchanged at exactly 50 clusters (no truncation)", async () => {
    const fifty = MANY.slice(0, 50);
    const r = await planItinerary(fakePort(fifty), { point_ids: ids(fifty) });
    expect(r.point_count).toBe(50);
    expect(r).not.toHaveProperty("truncated");
    expect(r).not.toHaveProperty("shown_cluster_count");
    expect(r).not.toHaveProperty("total_cluster_count");
  });
});

describe("planItinerary redacted observability", () => {
  it("records outcome, counts, truncation, and duration — never coordinates or titles", async () => {
    let tick = 0;
    const observed: ItineraryObservation[] = [];
    await planItinerary(fakePort(POINTS), { point_ids: ["a", "b", "c"] }, {
      observer: { record: (o) => observed.push(o) },
      clock: { now: () => tick++ },
    });
    expect(observed).toEqual([{ outcome: "planned", point_count: 3, cluster_count: 3, truncated: false, duration_ms: 1 }]);
    expect(JSON.stringify(observed)).not.toContain("Lucky Star");
    expect(JSON.stringify(observed)).not.toContain("35.0");
  });
  it("records an empty outcome with zero counts when no points resolve", async () => {
    const observed: ItineraryObservation[] = [];
    await planItinerary(fakePort([]), { point_ids: ["nope"] }, {
      observer: { record: (o) => observed.push(o) },
      clock: { now: () => 0 },
    });
    expect(observed[0]).toEqual({ outcome: "empty", point_count: 0, cluster_count: 0, truncated: false, duration_ms: 0 });
  });
});

describe("pointsForRoute outbound adapter — SQL fetch wired to the port", () => {
  it("loads requested ids in ids order and drops unknown ids", async () => {
    // The fake returns every point row; the adapter keeps only the requested ids
    // and reassembles them in the requested order, dropping unknown ids.
    const fakeDb: RouteDb = {
      execute: () => Promise.resolve({ rows: POINTS }),
    };
    const port = pointsForRoute(fakeDb);
    expect(ids(await port.loadPoints(["c", "nope", "a"]))).toEqual(["c", "a"]);
  });
  it("empty ids -> no query, no rows", async () => {
    let executed = false;
    const fakeDb: RouteDb = {
      execute: () => {
        executed = true;
        return Promise.resolve({ rows: [] });
      },
    };
    const port = pointsForRoute(fakeDb);
    expect(await port.loadPoints([])).toEqual([]);
    expect(executed).toBe(false);
  });
});

const seamHandler = new OpenAPIHandler(catalogRouter);
function seamContext(rows: unknown[][]): CatalogContext {
  const execute = () => Promise.resolve({ rows: rows.shift() ?? [] });
  const db = { execute } as unknown as CatalogDb;
  return { db };
}
function seamRow(id: string, lat: number, image: string): unknown {
  return {
    id, name: id.toUpperCase(), name_cn: null, bangumi_id: "k", episode: null,
    time_seconds: null, image, latitude: lat, longitude: 135.0,
    origin: null, title: "Lucky Star", title_cn: null, cover_url: null, city: "Tokyo",
  };
}
async function callItinerary(body: unknown, ctx: CatalogContext): Promise<Response> {
  const result = await seamHandler.handle(
    new Request("https://catalog.test/catalog/itinerary", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { context: ctx },
  );
  expect(result.matched).toBe(true);
  assert(result.response);
  return result.response;
}

describe("planItinerary route seam — handler composes the use case via the published route", () => {
  it("serves the deterministic use-case outcome through the route with a fake db", async () => {
    const response = await callItinerary({ point_ids: ["a"] }, seamContext([[seamRow("a", 35.0, "a.jpg")]]));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      point_count: 1,
      ordered_points: [{ id: "a", screenshot_url: "a.jpg" }],
    });
  });
  it("emits a redacted console observation from the route", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    try {
      await callItinerary({ point_ids: ["a"] }, seamContext([[seamRow("a", 35.0, "a.jpg")]]));
      const line = info.mock.calls.map((c) => String(c[0])).join("\n");
      expect(line).toContain("outcome=planned");
      expect(line).toContain("point_count=1");
      expect(line).toContain("cluster_count=1");
      expect(line).not.toContain("Lucky Star");
      expect(line).not.toContain("35.0");
    } finally {
      info.mockRestore();
    }
  });
});
