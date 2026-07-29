import { describe, expect, it } from "vitest";
import { itineraryView } from "../../../src/lib/chat/itinerary";
import { stopAt, ujiItinerary, walkLeg } from "./_route-fixtures";

describe("itineraryView stations (AC1: HH:MM timeline + gold-star highlight)", () => {
  it("keeps walking order and HH:MM strings from the contract payload", () => {
    const view = itineraryView(ujiItinerary());
    expect(view.stations.map((station) => station.name)).toEqual(["宇治橋", "京阪宇治駅", "宇治神社"]);
    expect(view.stations.map((station) => station.arrive)).toEqual(["10:00", "10:32", "11:00"]);
    expect(view.stations.map((station) => station.depart)).toEqual(["10:20", "10:52", "11:20"]);
  });

  it("highlights exactly the most-photographed station", () => {
    const view = itineraryView(ujiItinerary());
    expect(view.stations.map((station) => station.highlighted)).toEqual([false, true, false]);
  });

  it("highlights the first station when every photo count ties", () => {
    const stops = [stopAt("a", "A", "10:00", "10:10", 0, 34.9, 135.8), stopAt("b", "B", "10:20", "10:30", 0, 34.91, 135.8)];
    const view = itineraryView({ stops, legs: [], total_minutes: 30, total_distance_m: 500 });
    expect(view.stations.map((station) => station.highlighted)).toEqual([true, false]);
  });

  it("normalizes the empty-string time sentinel to undefined", () => {
    const stops = [stopAt("a", "A", "", "", 1, 34.9, 135.8)];
    const view = itineraryView({ stops, legs: [], total_minutes: 0, total_distance_m: 0 });
    expect(view.stations[0]?.arrive).toBeUndefined();
    expect(view.stations[0]?.depart).toBeUndefined();
  });
});

describe("itineraryView legs (AC1: walk capsule between stations)", () => {
  it("pairs each leg with the station it follows, keeping mode and minutes", () => {
    const view = itineraryView(ujiItinerary());
    expect(view.legs).toEqual([
      { mode: "walk", minutes: 12 },
      { mode: "transit", minutes: 8 },
    ]);
  });

  it("leaves a gap undefined when no leg connects two adjacent stations", () => {
    const stops = [stopAt("a", "A", "10:00", "10:10", 1, 34.9, 135.8), stopAt("b", "B", "10:20", "10:30", 0, 34.91, 135.8)];
    const view = itineraryView({ stops, legs: [walkLeg("x", "y", 5)], total_minutes: 30, total_distance_m: 500 });
    expect(view.legs).toEqual([undefined]);
  });
});

describe("itineraryView extras (pacing pill + maps CTA)", () => {
  it("carries pacing through and picks the first non-empty export URL", () => {
    const view = itineraryView({ ...ujiItinerary(), export_google_maps_url: ["", "https://maps.example/second"] });
    expect(view.pacing).toBe("chill");
    expect(view.mapsUrl).toBe("https://maps.example/second");
  });

  it("returns no maps URL when the export list is absent", () => {
    const view = itineraryView({ ...ujiItinerary(), export_google_maps_url: undefined });
    expect(view.mapsUrl).toBeUndefined();
  });
});
