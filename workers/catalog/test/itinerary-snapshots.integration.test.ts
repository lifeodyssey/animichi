import { afterAll, beforeAll, expect, it } from "vitest";
import { getItinerarySnapshot, saveItinerarySnapshot } from "../src/publish/snapshots";
import {
  databaseDescribe,
  openPlaneSeams,
  truncateCatalogPool,
  type PlaneSeams,
} from "./integration-db";

/**
 * Integration suite for itinerary snapshots (`src/publish/snapshots.ts`) over
 * `itinerary_snapshots`, against the committed Prisma chain's schema cloned into
 * the suite database: a snapshot saved for one version reads back unchanged
 * after a later version's snapshot is saved. The versions are literals; the
 * publish no longer mints them.
 */

let seams: PlaneSeams;

beforeAll(async () => {
  seams = await openPlaneSeams();
  await truncateCatalogPool(seams.pool);
}, 120_000);

afterAll(async () => {
  await seams.dispose();
});

databaseDescribe("saveItinerarySnapshot binds an itinerary to a version so it never drifts", () => {
  it("reads back a v1 snapshot unchanged after a v2 snapshot is saved (no drift)", async () => {
    await saveItinerarySnapshot(seams.query, "drift", 1, { order: ["a", "b"] });
    await saveItinerarySnapshot(seams.query, "drift", 2, { order: ["b", "a"] });
    const snap = (await getItinerarySnapshot(seams.query, "drift", 1)) as { order: string[] };
    expect(snap.order).toEqual(["a", "b"]);
  });
});
