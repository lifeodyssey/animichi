import { describe, expect, it } from "vitest";
import { planItinerary, type PointsForRoutePort, type ItineraryPoint } from "../src/application/plan-itinerary";
import { pointsForRoute, type RouteDb } from "../src/adapters/outbound/route-points";

/**
 * Tests at the use-case seam: `planItinerary` receives points through a fake
 * `PointsForRoutePort` — no DB, no SQL on this side. Verifies the
 * load -> cluster -> plan -> assemble orchestration and the contract `Itinerary`
 * assembly. A small adapter check covers the port wiring (ids order preserved,
 * unknown ids dropped) against a fake `RouteDb`.
 *
 * Fixture (3 points on a meridian, > 50m apart so each is its own cluster;
 * gaps a-b == b-c == 111.19 m, mirroring the kernel parity fixture):
 *   a (35.0000) bangumi "k" "Lucky Star"  image "a.jpg"
 *   b (35.0010) bangumi "k" "Lucky Star"
 *   c (35.0020) bangumi "k" "Lucky Star"
 */

function point(id: string, lat: number, image = ""): ItineraryPoint {
  return {
    id, name: id.toUpperCase(), bangumi_id: "k", screenshot_url: image,
    latitude: lat, longitude: 135.0,
    title: "Lucky Star", title_cn: "幸运星", cover_url: "cover.jpg", city: "Tokyo",
  };
}

const POINTS = [point("a", 35.0, "a.jpg"), point("b", 35.001), point("c", 35.002)];
const MANY_POINTS: ItineraryPoint[] = Array.from({ length: 51 }, (_, i) =>
  point(`p${String(i).padStart(3, "0")}`, 35 + i * 0.001),
);

/** A fake `PointsForRoutePort` returning only the requested ids, in ids order. */
function fakePort(points: ItineraryPoint[]): PointsForRoutePort {
  const byId = new Map(points.map((p) => [p.id, p]));
  return {
    loadPoints: (ids) =>
      Promise.resolve(ids.flatMap((id) => {
        const val = byId.get(id);
        return val ? [val] : [];
      })),
  };
}

const ids = (ps: ItineraryPoint[]): string[] => ps.map((p) => p.id);

describe("planItinerary use case — port load -> cluster -> plan -> Itinerary", () => {
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

  it("caps 51 clusters and discloses the successful truncation", async () => {
    const r = await planItinerary(fakePort(MANY_POINTS), { point_ids: ids(MANY_POINTS) });
    expect(r.point_count).toBe(50);
    expect(r.timed_itinerary.stops).toHaveLength(50);
    expect(ids(r.ordered_points)).not.toContain("p050");
    expect(r).toMatchObject({ truncated: true, shown_cluster_count: 50, total_cluster_count: 51 });
  });
});

describe("pointsForRoute outbound adapter — SQL fetch wired to the port", () => {
  it("loads requested ids in ids order and drops unknown ids", async () => {
    const fakeDb: RouteDb = {
      execute: (query) => {
        const text = JSON.stringify(query);
        const matched = POINTS.filter((p) => text.includes(`"${p.id}"`));
        return Promise.resolve({ rows: matched });
      },
    };
    const port = pointsForRoute(fakeDb);
    const loaded = await port.loadPoints(["c", "nope", "a"]);
    expect(ids(loaded)).toEqual(["c", "a"]);
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
