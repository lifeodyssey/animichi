/**
 * Duplicate spot tests (X15 #285, dedupe AC support).
 *
 * Pins the DuplicateSpots specification — same episode, strictly within the
 * dedupe radius — and the merge: same-episode rows cluster transitively at
 * the radius and each multi-row group collapses to its first row in input
 * order. Rows with an unknown (null) episode never merge.
 */
import { describe, expect, it } from "vitest";
import {
  areDuplicateSpots,
  mergeDuplicateSpots,
  type LocatedEpisodeSpot,
} from "../src/publish/duplicate-spots";
import { KYOTO, NORTH_24_5M, NORTH_26M, NORTH_48M } from "./spot-quality.fixtures";

function episodeSpot(
  id: string, episode: number | null, coordinates: { latitude: number; longitude: number },
): LocatedEpisodeSpot {
  return { id, episode, ...coordinates };
}

describe("areDuplicateSpots (the DuplicateSpots specification)", () => {
  it("holds for two spots of one episode within the dedupe radius", () => {
    const a = episodeSpot("a", 3, KYOTO);
    const b = episodeSpot("b", 3, NORTH_24_5M);
    expect(areDuplicateSpots(a, b)).toBe(true);
  });

  it("does not hold beyond the dedupe radius", () => {
    const a = episodeSpot("a", 3, KYOTO);
    const b = episodeSpot("b", 3, NORTH_26M);
    expect(areDuplicateSpots(a, b)).toBe(false);
  });

  it("does not hold across different episodes, even at the same coordinates", () => {
    const a = episodeSpot("a", 3, KYOTO);
    const b = episodeSpot("b", 4, KYOTO);
    expect(areDuplicateSpots(a, b)).toBe(false);
  });

  it("does not hold when either episode is unknown (null)", () => {
    const known = episodeSpot("a", 3, KYOTO);
    const unknown = episodeSpot("b", null, KYOTO);
    expect(areDuplicateSpots(known, unknown)).toBe(false);
    expect(areDuplicateSpots(unknown, known)).toBe(false);
    expect(areDuplicateSpots(unknown, unknown)).toBe(false);
  });
});

describe("mergeDuplicateSpots (the dedupe/merge policy)", () => {
  it("collapses a same-episode pair within the radius to its first row and reports the merge", () => {
    const rows = [
      episodeSpot("p-a", 3, KYOTO),
      episodeSpot("p-b", 3, NORTH_24_5M),
    ];
    const merged = mergeDuplicateSpots(rows);
    expect(merged.publishable.map((row) => row.id)).toEqual(["p-a"]);
    expect(merged.merges).toEqual([{ keptSpotId: "p-a", mergedSpotIds: ["p-b"] }]);
  });

  it("keeps both rows when the same-episode pair sits beyond the radius", () => {
    const rows = [
      episodeSpot("p-a", 3, KYOTO),
      episodeSpot("p-b", 3, NORTH_26M),
    ];
    const merged = mergeDuplicateSpots(rows);
    expect(merged.publishable.map((row) => row.id)).toEqual(["p-a", "p-b"]);
    expect(merged.merges).toEqual([]);
  });

  it("keeps same-coordinate rows of different episodes", () => {
    const rows = [
      episodeSpot("p-a", 3, KYOTO),
      episodeSpot("p-b", 4, KYOTO),
    ];
    const merged = mergeDuplicateSpots(rows);
    expect(merged.publishable.map((row) => row.id)).toEqual(["p-a", "p-b"]);
    expect(merged.merges).toEqual([]);
  });

  it("never merges rows with an unknown episode", () => {
    const rows = [
      episodeSpot("p-a", null, KYOTO),
      episodeSpot("p-b", null, KYOTO),
    ];
    const merged = mergeDuplicateSpots(rows);
    expect(merged.publishable.map((row) => row.id)).toEqual(["p-a", "p-b"]);
    expect(merged.merges).toEqual([]);
  });
});

describe("mergeDuplicateSpots (group representative and order)", () => {
  it("merges a transitive chain into one group even though its ends sit 48 m apart", () => {
    const rows = [
      episodeSpot("p-a", 3, KYOTO),
      episodeSpot("p-b", 3, NORTH_24_5M),
      episodeSpot("p-c", 3, NORTH_48M),
    ];
    const merged = mergeDuplicateSpots(rows);
    expect(merged.publishable.map((row) => row.id)).toEqual(["p-a"]);
    expect(merged.merges).toEqual([{ keptSpotId: "p-a", mergedSpotIds: ["p-b", "p-c"] }]);
  });

  it("keeps the first row in input order as the group representative, not the lowest id", () => {
    const rows = [
      episodeSpot("p-z", 3, NORTH_24_5M),
      episodeSpot("p-a", 3, KYOTO),
    ];
    const merged = mergeDuplicateSpots(rows);
    expect(merged.publishable.map((row) => row.id)).toEqual(["p-z"]);
    expect(merged.merges).toEqual([{ keptSpotId: "p-z", mergedSpotIds: ["p-a"] }]);
  });

  it("passes distinct same-episode spots through untouched and in input order", () => {
    const rows = [
      episodeSpot("p-c", 3, NORTH_26M),
      episodeSpot("p-a", 3, KYOTO),
      episodeSpot("p-b", 7, KYOTO),
    ];
    const merged = mergeDuplicateSpots(rows);
    expect(merged.publishable.map((row) => row.id)).toEqual(["p-c", "p-a", "p-b"]);
    expect(merged.merges).toEqual([]);
  });
});
