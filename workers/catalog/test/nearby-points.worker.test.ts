import { describe, expect, it } from "vitest";
import {
  InvalidRadiusError,
  MAX_RADIUS_M,
  nearbyPoints,
  type NearbyClock,
  type NearbyObservation,
  type NearbyObserverPort,
  type NearbyPoint,
  type NearbyPointsPort,
  type PointDetail,
  type PointDetailsPort,
} from "../src/application/nearby-points";

/**
 * Unit tests for the `nearbyPoints` use case (card CATALOG-3): radius policy
 * (reject non-positive, clamp over-cap), deterministic distance ordering,
 * typed empty results, DB-failure propagation, and redacted observability.
 * Ports are fakes; the real PostGIS surface is proven in
 * nearby-points.spike.test.ts. The clock is faked, so durations are exact.
 */

const WASHINOMIYA: NearbyPoint = {
  id: "washinomiya", name: "鷲宮神社", latitude: 36.1019, longitude: 139.6586, distanceM: 5,
};
const SATTE: NearbyPoint = {
  id: "satte", name: "幸手権現堂", latitude: 36.0833, longitude: 139.725, distanceM: 4200,
};
const DETAIL: PointDetail = {
  id: "washinomiya", bangumi_id: "lucky-star", name_cn: "鹫宫神社", image: "https://img/w.jpg",
  episode: 1, time_seconds: 12, origin: "anitabi", city: "Kuki",
};

const fixedClock: NearbyClock = { now: () => 42 };

/** Fake port: returns `rows`, recording every radius the use case sends. */
function geoPort(rows: NearbyPoint[], received: number[] = []): NearbyPointsPort {
  return {
    pointsWithin: (_lat, _lng, radiusM) => {
      received.push(radiusM);
      return Promise.resolve(rows);
    },
  };
}

function detailPort(rows: PointDetail[]): PointDetailsPort {
  const byId = new Map(rows.map((row) => [row.id, row]));
  return { detailsFor: () => Promise.resolve(byId) };
}

/** Port that always fails: proves the use case propagates adapter failures. */
function failingPort(): NearbyPointsPort {
  return { pointsWithin: () => Promise.reject(new Error("postgis down")) };
}

function observer(): { observations: NearbyObservation[]; port: NearbyObserverPort } {
  const observations: NearbyObservation[] = [];
  return { observations, port: { record: (observation) => { observations.push(observation); } } };
}

const run = (geo: NearbyPointsPort, details: PointDetailsPort, radius_m: number) =>
  nearbyPoints(geo, details, { lat: 36.1019, lng: 139.6586, radius_m }, { clock: fixedClock });

describe("nearbyPoints radius policy", () => {
  it("clamps an over-cap radius before the port call", async () => {
    const received: number[] = [];
    await run(geoPort([], received), detailPort([]), MAX_RADIUS_M * 4);
    expect(received).toEqual([MAX_RADIUS_M]);
  });

  it("passes an under-cap radius through unchanged", async () => {
    const received: number[] = [];
    await run(geoPort([], received), detailPort([]), 1_000);
    expect(received).toEqual([1_000]);
  });

  it("accepts the upper radius boundary", async () => {
    const received: number[] = [];
    await run(geoPort([], received), detailPort([]), MAX_RADIUS_M);
    expect(received).toEqual([MAX_RADIUS_M]);
  });

  it("rejects a zero radius without touching the port", async () => {
    const unreachable: NearbyPointsPort = {
      pointsWithin: () => Promise.reject(new Error("port must not run")),
    };
    await expect(run(unreachable, detailPort([]), 0)).rejects.toBeInstanceOf(InvalidRadiusError);
  });

  it("rejects a negative radius", async () => {
    const unreachable: NearbyPointsPort = {
      pointsWithin: () => Promise.reject(new Error("port must not run")),
    };
    await expect(run(unreachable, detailPort([]), -1)).rejects.toBeInstanceOf(InvalidRadiusError);
  });
});

describe("nearbyPoints distance ordering", () => {
  it("orders nearest-first even when the port returns out of order", async () => {
    const { rows } = await run(geoPort([SATTE, WASHINOMIYA]), detailPort([]), 10_000);
    expect(rows.map((row) => row.id)).toEqual(["washinomiya", "satte"]);
    expect(rows.map((row) => row.distance_m)).toEqual([5, 4200]);
  });

  it("breaks equal distances deterministically by id", async () => {
    const lateTie: NearbyPoint = {
      id: "z-point", name: "z", latitude: 36, longitude: 139, distanceM: 5,
    };
    const { rows } = await run(geoPort([lateTie, WASHINOMIYA]), detailPort([]), 10_000);
    expect(rows.map((row) => row.id)).toEqual(["washinomiya", "z-point"]);
  });

  it("moves an id-earlier hit ahead of an equal-distance id-later hit", async () => {
    const earlyTie: NearbyPoint = {
      id: "a-point", name: "a", latitude: 36, longitude: 139, distanceM: 5,
    };
    const { rows } = await run(geoPort([earlyTie, WASHINOMIYA]), detailPort([]), 10_000);
    expect(rows.map((row) => row.id)).toEqual(["a-point", "washinomiya"]);
  });
});

describe("nearbyPoints typed empty result", () => {
  it("returns an empty rows array when no point is within the radius", async () => {
    const { rows } = await run(geoPort([]), detailPort([]), 10_000);
    expect(rows).toEqual([]);
  });

  it("keeps sentinel defaults when a point has no detail row", async () => {
    const { rows } = await run(geoPort([WASHINOMIYA, SATTE]), detailPort([DETAIL]), 10_000);
    expect(rows[1]).toMatchObject({ bangumi_id: "", screenshot_url: "" });
    expect(rows[1]?.name_cn).toBeUndefined();
    expect(rows[1]?.episode).toBeUndefined();
  });
});

describe("nearbyPoints merge", () => {
  it("merges detail columns onto the contract Point shape", async () => {
    const { rows } = await run(geoPort([WASHINOMIYA]), detailPort([DETAIL]), 10_000);
    expect(rows[0]).toMatchObject({
      id: "washinomiya",
      name: "鷲宮神社",
      name_cn: "鹫宫神社",
      bangumi_id: "lucky-star",
      episode: 1,
      time_seconds: 12,
      screenshot_url: "https://img/w.jpg",
      latitude: 36.1019,
      longitude: 139.6586,
      distance_m: 5,
      origin: "anitabi",
      city: "Kuki",
    });
  });
});

describe("nearbyPoints database failure", () => {
  it("propagates the adapter failure", async () => {
    await expect(run(failingPort(), detailPort([]), 10_000)).rejects.toThrow("postgis down");
  });

  it("records db_error with count zero when the port fails", async () => {
    const recorded = observer();
    await expect(
      nearbyPoints(failingPort(), detailPort([]), { lat: 1, lng: 2, radius_m: 500 }, { clock: fixedClock, observer: recorded.port }),
    ).rejects.toThrow("postgis down");
    expect(recorded.observations).toEqual([
      { radius_bucket: "lt-1km", count: 0, outcome: "db_error", duration_ms: 0 },
    ]);
  });
});

describe("nearbyPoints redacted observability", () => {
  it("records an ok observation: bucket, count, outcome, duration", async () => {
    const recorded = observer();
    await nearbyPoints(geoPort([WASHINOMIYA]), detailPort([DETAIL]), { lat: 1, lng: 2, radius_m: 5_000 }, { clock: fixedClock, observer: recorded.port });
    expect(recorded.observations).toEqual([
      { radius_bucket: "1km-10km", count: 1, outcome: "ok", duration_ms: 0 },
    ]);
  });

  it("buckets an over-cap requested radius as over-cap while clamping the query", async () => {
    const recorded = observer();
    await nearbyPoints(geoPort([]), detailPort([]), { lat: 1, lng: 2, radius_m: MAX_RADIUS_M + 1 }, { clock: fixedClock, observer: recorded.port });
    expect(recorded.observations[0]?.radius_bucket).toBe("over-cap");
  });

  it("buckets the maximum radius as 10km-50km", async () => {
    const recorded = observer();
    await nearbyPoints(geoPort([]), detailPort([]), { lat: 1, lng: 2, radius_m: MAX_RADIUS_M }, { clock: fixedClock, observer: recorded.port });
    expect(recorded.observations[0]?.radius_bucket).toBe("10km-50km");
  });

  it("records no observation for an invalid radius", async () => {
    const recorded = observer();
    await expect(
      nearbyPoints(geoPort([]), detailPort([]), { lat: 1, lng: 2, radius_m: 0 }, { clock: fixedClock, observer: recorded.port }),
    ).rejects.toBeInstanceOf(InvalidRadiusError);
    expect(recorded.observations).toEqual([]);
  });
});
