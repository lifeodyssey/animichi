import { describe, expect, it } from "vitest";
import { placeIdToggles, selectedPlacesFromSpots, toSelectedPlace } from "../../../src/features/chat/lib/selected-places";
import type { SelectedPlace } from "../../../src/features/chat/lib/selected-places";
import type { SearchSpot } from "../../../src/features/chat/lib/spot-clusters";

const spots: readonly [SearchSpot, SearchSpot] = [
  { id: "bridge", name: "宇治橋", city: "宇治市", screenshotUrl: "/bridge.webp" },
  { id: "station", name: "京阪宇治駅", city: "宇治市" },
];
const [bridge, station] = spots;

const listed: readonly SelectedPlace[] = [
  { id: "bridge", name: "宇治橋", city: "宇治市", viewpoints: [{ id: "bridge-scene", frames: [] }] },
  { id: "station", name: "京阪宇治駅", city: "宇治市", viewpoints: [{ id: "station-scene", frames: [] }] },
];

describe("toSelectedPlace", () => {
  it("carries the captured frame under the spot's own identity", () => {
    const place = toSelectedPlace(bridge);
    expect(place.id).toBe("bridge");
    expect(place.viewpoints).toEqual([{ id: "bridge-scene", frames: [{ id: "bridge-frame", url: "/bridge.webp" }] }]);
  });

  it("keeps a place reviewable without any captured frame", () => {
    expect(toSelectedPlace(station).viewpoints).toEqual([{ id: "station-scene", frames: [] }]);
  });
});

describe("selectedPlacesFromSpots", () => {
  it("keys membership on the place id, never on the array index", () => {
    const selected = new Set(["station"]);
    expect(selectedPlacesFromSpots(spots, selected).map((place) => place.id)).toEqual(["station"]);
    expect(selectedPlacesFromSpots([...spots].reverse(), selected).map((place) => place.id)).toEqual(["station"]);
  });

  it("keeps the caller's spot order and deduplicates nothing away", () => {
    const selected = new Set(["station", "bridge"]);
    expect(selectedPlacesFromSpots(spots, selected).map((place) => place.id)).toEqual(["bridge", "station"]);
    expect(selectedPlacesFromSpots(spots, new Set())).toEqual([]);
  });
});

describe("placeIdToggles", () => {
  it("deselects exactly the places the next list dropped", () => {
    expect(placeIdToggles(listed, listed.slice(1))).toEqual(["bridge"]);
  });

  it("re-selects exactly the places an undo restored", () => {
    expect(placeIdToggles(listed.slice(1), listed)).toEqual(["bridge"]);
  });

  it("flips nothing when the two lists agree", () => {
    expect(placeIdToggles(listed, [...listed].reverse())).toEqual([]);
  });
});
