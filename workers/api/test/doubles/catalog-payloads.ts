/** Real-shaped catalog payloads, copied from `workers/catalog`'s own tests
 * (`test/search-row-shape.worker.test.ts`, `test/nearby-points.worker.test.ts`,
 * `test/geocode-place.worker.test.ts`) so the tool tests exercise the shapes the
 * catalog actually returns rather than a shape invented here. */
import type { GeocodeCandidate, Itinerary, Point } from "@animichi/contract";

/** One published point, exactly as the catalog's joined-row snapshot emits it. */
export const WASHINOMIYA: Point = {
  id: "spot-1",
  name: "鷲宮神社",
  name_cn: "鹫宫神社",
  bangumi_id: "1",
  episode: 3,
  time_seconds: 120,
  screenshot_url: "https://image.anitabi.cn/p1.jpg",
  latitude: 36.1019,
  longitude: 139.6586,
  city: "Kuki",
  title: "らき☆すた",
  title_cn: "幸运星",
  cover_url: "https://image.anitabi.cn/cover1.jpg",
};

/** A second point in the same work, so a route has something to order. */
export const SATTE: Point = {
  ...WASHINOMIYA,
  id: "spot-2",
  name: "幸手権現堂",
  name_cn: "幸手权现堂",
  screenshot_url: "https://image.anitabi.cn/p2.jpg",
  latitude: 36.0833,
  longitude: 139.725,
};

/** A point in a city the GeoNames table knows, from the catalog's
 * `work-points.fixtures.ts` (宇治橋, 響け！ユーフォニアム). */
export const UJI_BRIDGE: Point = {
  id: "published-1",
  name: "宇治橋",
  bangumi_id: "115908",
  episode: 1,
  time_seconds: 120,
  screenshot_url: "https://image.anitabi.cn/published.jpg",
  latitude: 34.8915,
  longitude: 135.8078,
  city: "Uji",
  title: "響け！ユーフォニアム",
};

/** One gazetteer candidate, as `geocode-place.worker.test.ts` returns them. */
export const KUKI_STATION: GeocodeCandidate = {
  id: "seed:kuki-station",
  label: "久喜駅",
  name: "久喜駅",
  lat: 36.0621,
  lng: 139.6669,
  kind: "station",
  source: "seed",
  effective_radius_m: 5_000,
};

/** A prefecture candidate: resolvable, but too broad to search around. */
export const SAITAMA: GeocodeCandidate = {
  ...KUKI_STATION,
  id: "seed:saitama",
  label: "埼玉県",
  name: "埼玉県",
  kind: "prefecture",
  effective_radius_m: undefined,
};

/** A planned two-stop route, in the catalog's `Itinerary` shape. */
export const LUCKY_STAR_ROUTE: Itinerary = {
  ordered_points: [WASHINOMIYA, SATTE],
  point_count: 2,
  timed_itinerary: {
    stops: [
      { cluster_id: "c1", name: "鷲宮神社", arrive: "10:00", depart: "10:40", dwell_minutes: 40, lat: 36.1019, lng: 139.6586, photo_count: 3 },
      { cluster_id: "c2", name: "幸手権現堂", arrive: "11:20", depart: "12:00", dwell_minutes: 40, lat: 36.0833, lng: 139.725, photo_count: 1 },
    ],
    legs: [{ from_id: "c1", to_id: "c2", mode: "walk", duration_minutes: 40, distance_m: 4_200 }],
    total_minutes: 120,
    total_distance_m: 4_200,
    spot_count: 2,
    pacing: "normal",
  },
};

/** Twelve stops of one work, ids `spot-1` … `spot-12` in visit order. */
const TWELVE_POINTS: Point[] = Array.from({ length: 12 }, (_unused, index) => ({
  ...WASHINOMIYA,
  id: `spot-${String(index + 1)}`,
  name: `聖地 ${String(index + 1)}`,
}));

/**
 * A twelve-stop route (#1389).
 *
 * Twelve rather than two because that is where `plan_route`'s own outcome goes
 * past `TOOL_RETURN_MAX_CHARS` and the frozen summary becomes what a later turn
 * is shown of the route — the case an ordinal follow-up has to survive.
 */
export const TWELVE_STOP_ROUTE: Itinerary = {
  ordered_points: TWELVE_POINTS,
  point_count: TWELVE_POINTS.length,
  timed_itinerary: {
    stops: TWELVE_POINTS.map((point) => ({
      cluster_id: point.id,
      name: point.name,
      arrive: "10:00",
      depart: "10:40",
      dwell_minutes: 40,
      lat: point.latitude,
      lng: point.longitude,
      photo_count: 1,
    })),
    legs: [],
    total_minutes: 480,
    total_distance_m: 12_000,
    spot_count: TWELVE_POINTS.length,
    pacing: "normal",
  },
};

/** The stops that route visits, in order — what "the second stop" lands on. */
export const TWELVE_STOP_IDS: readonly string[] = TWELVE_POINTS.map((point) => point.id);
