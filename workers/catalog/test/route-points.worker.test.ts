import { describe, expect, it } from "vitest";
import { pointsForRoute, type ItineraryPointRow } from "../src/adapters/outbound/route-points";
import { fakeCatalogPrisma } from "./fakes/fake-catalog-prisma";

/**
 * `pointsForRoute` (src/adapters/outbound/route-points.ts), the itinerary's only
 * read: the itinerary point one joined points+bangumi row becomes. The builder is
 * the real contract-bound one and only the executor is doubled
 * (`fakes/fake-catalog-prisma.ts`). Id order and the empty-ids short cut are
 * covered beside the use case, in `plan-itinerary.worker.test.ts`.
 */

/** A joined row with every column set, the work's titles included. */
const FULL_ROW: ItineraryPointRow = {
  id: "route-1", name: "鷲宮神社", name_cn: "鹫宫神社", bangumi_id: "1", episode: 3, time_seconds: 120,
  image: "https://photos.invalid/route-1.jpg", latitude: 36.1019, longitude: 139.6586,
  origin: "Anitabi", origin_url: "https://origin.invalid/route-1",
  title: "らき☆すた", title_cn: "幸运星", cover_url: "https://covers.invalid/1.jpg", city: "Kuki",
};

/** {@link FULL_ROW} with every nullable column null. */
const BARE_ROW: ItineraryPointRow = {
  ...FULL_ROW, name_cn: null, bangumi_id: null, episode: null, time_seconds: null, image: null,
  origin: null, origin_url: null, title: null, title_cn: null, cover_url: null, city: null,
};

describe("pointsForRoute maps a joined row to an itinerary point", () => {
  it("carries every column of a fully populated row", async () => {
    const points = await pointsForRoute(fakeCatalogPrisma([FULL_ROW])).loadPoints(["route-1"]);
    expect(points).toStrictEqual([{
      id: "route-1", name: "鷲宮神社", name_cn: "鹫宫神社", bangumi_id: "1", episode: 3, time_seconds: 120,
      screenshot_url: "https://photos.invalid/route-1.jpg", latitude: 36.1019, longitude: 139.6586,
      origin: "Anitabi", origin_url: "https://origin.invalid/route-1",
      title: "らき☆すた", title_cn: "幸运星", cover_url: "https://covers.invalid/1.jpg", city: "Kuki",
    }]);
  });

  it("keeps only the required fields when every nullable column is null", async () => {
    const points = await pointsForRoute(fakeCatalogPrisma([BARE_ROW])).loadPoints(["route-1"]);
    expect(points).toStrictEqual([
      { id: "route-1", name: "鷲宮神社", bangumi_id: "", screenshot_url: "", latitude: 36.1019, longitude: 139.6586 },
    ]);
  });
});
