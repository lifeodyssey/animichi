import { describe, expect, it } from "vitest";
import {
  composeShiori,
  type ShioriSource,
} from "../../../src/features/shiori/compose";
import { makeItinerary, makeMeta, makePhotos, makeStop } from "./_factories";

function makeSource(overrides: Partial<ShioriSource> = {}): ShioriSource {
  return {
    meta: makeMeta(),
    itinerary: makeItinerary(),
    photos: makePhotos(2),
    checkedStopIds: [],
    isRouteDayOver: false,
    ...overrides,
  };
}

const ALL_CHECKED = ["stop-station", "stop-shrine"];

describe("composeShiori mode decision", () => {
  it("generates the planned version when no stop is checked in", () => {
    const composed = composeShiori(makeSource());

    expect(composed.mode).toBe("planned");
    expect(composed.status).toBe("planned");
    expect(composed.completion).toBeNull();
  });

  it("stays planned with zero check-ins even when the route day is over", () => {
    const composed = composeShiori(makeSource({ isRouteDayOver: true }));

    expect(composed.mode).toBe("planned");
  });

  it("generates the commemorative version when every stop is checked in", () => {
    const composed = composeShiori(makeSource({ checkedStopIds: ALL_CHECKED }));

    expect(composed.mode).toBe("commemorative");
    expect(composed.status).toBe("completed");
    expect(composed.completion).toEqual({ checkedCount: 2, stopCount: 2, ratePercent: 100 });
  });

  it("generates the commemorative version for a partial run once the day is over", () => {
    const composed = composeShiori(
      makeSource({ checkedStopIds: ["stop-shrine"], isRouteDayOver: true }),
    );

    expect(composed.mode).toBe("commemorative");
    expect(composed.completion).toEqual({ checkedCount: 1, stopCount: 2, ratePercent: 50 });
  });

  it("stays planned for a partial run while the day is still running", () => {
    const composed = composeShiori(makeSource({ checkedStopIds: ["stop-shrine"] }));

    expect(composed.mode).toBe("planned");
  });

  it("ignores duplicate and unknown check-in ids", () => {
    const composed = composeShiori(
      makeSource({
        checkedStopIds: ["stop-shrine", "stop-shrine", "ghost-stop"],
        isRouteDayOver: true,
      }),
    );

    expect(composed.completion).toEqual({ checkedCount: 1, stopCount: 2, ratePercent: 50 });
  });

  it("stays planned for an itinerary with zero stops", () => {
    const itinerary = makeItinerary({ stops: [] });
    const composed = composeShiori(
      makeSource({ itinerary, checkedStopIds: ["ghost-stop"], isRouteDayOver: true }),
    );

    expect(composed.mode).toBe("planned");
    expect(composed.stats.timeWindow).toBeNull();
  });
});

describe("composeShiori layout and stats", () => {
  it("keeps the ticket layout for planned routes regardless of photos", () => {
    const composed = composeShiori(makeSource({ photos: makePhotos(5) }));

    expect(composed.layout).toBe("ticket");
  });

  it.each([
    [0, "poster-fallback"],
    [1, "single-panel"],
    [3, "album-grid"],
  ] as const)("routes a completed run with %i photos to %s", (count, layout) => {
    const composed = composeShiori(
      makeSource({ photos: makePhotos(count), checkedStopIds: ALL_CHECKED }),
    );

    expect(composed.layout).toBe(layout);
  });

  it("summarises walking time, distance and time window", () => {
    const composed = composeShiori(makeSource());

    expect(composed.stats).toEqual({ walkMinutes: 210, distanceKm: 2.8, timeWindow: "09:31→12:58" });
  });

  it("rounds the distance to one decimal", () => {
    const itinerary = makeItinerary({ total_distance_m: 1234 });

    expect(composeShiori(makeSource({ itinerary })).stats.distanceKm).toBe(1.2);
  });

  it("passes meta, itinerary and photos through for rendering", () => {
    const single = composeShiori(
      makeSource({ photos: makePhotos(1), checkedStopIds: ALL_CHECKED }),
    );

    expect(single.meta.routeTitle).toBe("飛騨古川 半日ルート");
    expect(single.itinerary.stops[0]).toEqual(makeStop());
    expect(single.photos).toHaveLength(1);
  });
});
