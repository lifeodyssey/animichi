/**
 * Daily inventory builder (MAJOR-1): the seasonal resolver is threaded into the
 * `current_season` discovery source and into tier assignment.
 */
import { describe, expect, it } from "vitest";
import { buildDailyInventory } from "../src/ingest/daily-discovery";
import { fakeCatalogPrisma } from "./fakes/fake-catalog-prisma";

/** A seam whose only read (bangumi ids) answers no rows. */
function emptySeam() {
  return fakeCatalogPrisma([]);
}

describe("buildDailyInventory (MAJOR-1)", () => {
  it("feeds the resolver's ids as the current_season discovery source", async () => {
    const inventory = await buildDailyInventory(emptySeam(), () => Promise.resolve(["1", "2"]));
    const season = inventory.discovery.find((d) => d.source === "current_season");
    expect(season?.bangumiIds).toEqual(["1", "2"]);
  });

  it("assigns a season-only id the high tier for fast refresh", async () => {
    const inventory = await buildDailyInventory(emptySeam(), () => Promise.resolve(["200"]));
    const tiered = inventory.tiered.find((w) => w.bangumiId === "200");
    expect(tiered?.tier).toBe("high");
  });

  it("defaults to an empty season when no resolver is provided (kept OFF by wiring)", async () => {
    const inventory = await buildDailyInventory(emptySeam());
    expect(inventory.discovery.find((d) => d.source === "current_season")?.bangumiIds).toEqual([]);
  });
});
