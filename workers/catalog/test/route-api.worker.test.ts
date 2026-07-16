import { describe, expect, it } from "vitest";
import { ORPCError } from "@orpc/server";
import { route, type PilgrimagePoint, type RouteDb } from "../src/api/route";

/**
 * Tests for the `route` read API handler (catalog/src/api/route.ts), which
 * composes the data layer (fetch points + bangumi) with the pure W2-1 kernel
 * (catalog/src/lib/route.ts) to produce a contract `Route`.
 *
 * No Docker: a typed fake `RouteDb` returns fixture rows shaped exactly like the
 * `SELECT ... FROM points LEFT JOIN bangumi` the handler issues, so this is a
 * pure-logic check of fetch -> cluster -> itinerary -> Route assembly. Named
 * *.worker.test.ts so the vitest-pool-workers config picks it up.
 *
 * Fixture (3 points on a meridian, > 50m apart so each is its own cluster;
 * gaps a-b == b-c == 111.19 m, mirroring the kernel parity fixture):
 *   a (35.0000) bangumi "k" "Lucky Star"  image "a.jpg"
 *   b (35.0010) bangumi "k" "Lucky Star"
 *   c (35.0020) bangumi "k" "Lucky Star"
 */

interface FakeRow {
  id: string;
  name: string;
  name_cn: string | null;
  bangumi_id: string;
  episode: number | null;
  time_seconds: number | null;
  image: string | null;
  latitude: number;
  longitude: number;
  origin: string | null;
  title: string | null;
  title_cn: string | null;
  cover_url: string | null;
  city: string | null;
}

function row(id: string, lat: number, image: string | null = null): FakeRow {
  return {
    id,
    name: id.toUpperCase(),
    name_cn: null,
    bangumi_id: "k",
    episode: null,
    time_seconds: null,
    image,
    latitude: lat,
    longitude: 135.0,
    origin: null,
    title: "Lucky Star",
    title_cn: "幸运星",
    cover_url: "cover.jpg",
    city: "Tokyo",
  };
}

const ROWS: FakeRow[] = [row("a", 35.0, "a.jpg"), row("b", 35.001), row("c", 35.002)];
const MANY_ROWS: FakeRow[] = Array.from({ length: 51 }, (_, i) =>
  row(`p${String(i).padStart(3, "0")}`, 35 + i * 0.001),
);

/** A typed fake `RouteDb` that returns only the fixture rows whose id is in IN. */
function fakeDb(rows: FakeRow[]): RouteDb {
  return {
    execute: (query) => {
      const text = JSON.stringify(query);
      const matched = rows.filter((r) => text.includes(`"${r.id}"`));
      return Promise.resolve({ rows: matched });
    },
  };
}

const ids = (ps: PilgrimagePoint[]): string[] => ps.map((p) => p.id);

async function routeError(rows: FakeRow[]): Promise<ORPCError<string, unknown>> {
  try {
    await route(fakeDb(rows), { point_ids: rows.map((r) => r.id) });
  } catch (err) {
    expect(err).toBeInstanceOf(ORPCError);
    return err as ORPCError<string, unknown>;
  }
  throw new Error("expected route to reject");
}

async function assertTimedRoute(): Promise<void> {
  const r = await route(fakeDb(ROWS), { point_ids: ["a", "b", "c"], pacing: "normal" });
  expect(r.point_count).toBe(3);
  expect(r.timed_itinerary.stops.map((s) => s.cluster_id)).toEqual(["a", "b", "c"]);
  expect(r.timed_itinerary.legs.map((l) => [l.from_id, l.to_id])).toEqual([["a", "b"], ["b", "c"]]);
  expect(r.timed_itinerary.total_minutes).toBe(28);
  expect(r.timed_itinerary.total_distance_m).toBe(222.4);
}

async function assertPointFields(): Promise<void> {
  const r = await route(fakeDb(ROWS), { point_ids: ["a"] });
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- test data known to exist
  const a = r.ordered_points[0]!;
  expect(a.screenshot_url).toBe("a.jpg");
  expect(a.bangumi_id).toBe("k");
  expect(a.latitude).toBe(35.0);
  expect(a.city).toBe("Tokyo");
  expect(r.timed_itinerary.legs).toEqual([]);
}

describe("route API handler — fetch -> cluster -> itinerary -> Route", () => {
  it("plans a timed route with a stop+leg itinerary for the selected ids", assertTimedRoute);

  it("returns ordered_points in itinerary order (NN from origin near c -> c,b,a)", async () => {
    const r = await route(fakeDb(ROWS), { point_ids: ["a", "b", "c"], origin: { lat: 35.0025, lng: 135.0 } });
    expect(ids(r.ordered_points)).toEqual(["c", "b", "a"]);
    expect(r.timed_itinerary.stops.map((s) => s.cluster_id)).toEqual(["c", "b", "a"]);
  });

  it("ordered_points (no origin) follow alphabetical NN seed a,b,c", async () => {
    const r = await route(fakeDb(ROWS), { point_ids: ["c", "a", "b"] });
    expect(ids(r.ordered_points)).toEqual(["a", "b", "c"]);
    expect(r.point_count).toBe(3);
  });

  it("carries anime title + cover metadata from the lead point", async () => {
    const r = await route(fakeDb(ROWS), { point_ids: ["a", "b", "c"] });
    expect(r.anime_title).toBe("Lucky Star");
    expect(r.anime_title_cn).toBe("幸运星");
    expect(r.cover_url).toBe("cover.jpg");
  });

  it("maps point fields: screenshot_url from image, coordinates as numbers", assertPointFields);

  it("unknown ids -> point_count 0 with an empty itinerary", async () => {
    const r = await route(fakeDb(ROWS), { point_ids: ["nope", "missing"] });
    expect(r.point_count).toBe(0);
    expect(r.ordered_points).toEqual([]);
    expect(r.timed_itinerary.stops).toEqual([]);
    expect(r.timed_itinerary.total_minutes).toBe(0);
  });

  it("empty point_ids -> point_count 0 (no DB rows)", async () => {
    const r = await route(fakeDb(ROWS), { point_ids: [] });
    expect(r.point_count).toBe(0);
    expect(r.ordered_points).toEqual([]);
  });

  it("rejects with a defined typed error when the selected points make 51 clusters", async () => {
    const err = await routeError(MANY_ROWS);
    expect(err.code).toBe("ROUTE_TOO_MANY_CLUSTERS");
    expect(err.status).toBe(422);
    expect(err.defined).toBe(true);
    expect(err.data).toEqual({ cluster_count: 51, max_clusters: 50 });
  });
});
