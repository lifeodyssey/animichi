/**
 * Spot count drift tests (X15 #285, alerting AC support).
 *
 * Pins the SpotCountDrift policy: a work whose publishable spot count moves
 * by DRIFT_ALERT_RATIO or more against its last publish raises an alert; a
 * zero baseline (a work gaining its first spots) is growth, never drift.
 */
import { describe, expect, it } from "vitest";
import {
  DRIFT_ALERT_RATIO,
  spotCountDrifts,
  spotCountsByWork,
} from "../src/publish/spot-count-drift";

function counts(entries: readonly (readonly [string, number])[]): ReadonlyMap<string, number> {
  return new Map(entries);
}

describe("spotCountsByWork", () => {
  it("aggregates row counts per work", () => {
    const rows = [
      { bangumiId: "w1" }, { bangumiId: "w1" }, { bangumiId: "w2" },
    ];
    expect(spotCountsByWork(rows)).toEqual(counts([["w1", 2], ["w2", 1]]));
  });

  it("skips rows without a work", () => {
    const rows = [{ bangumiId: "w1" }, { bangumiId: null }];
    expect(spotCountsByWork(rows)).toEqual(counts([["w1", 1]]));
  });
});

describe("DRIFT_ALERT_RATIO", () => {
  it("starts at the card's initial ±30%", () => {
    expect(DRIFT_ALERT_RATIO).toBe(0.3);
  });
});

describe("spotCountDrifts", () => {
  it("alerts at exactly +30% — the 'or more' boundary is inclusive", () => {
    const drifts = spotCountDrifts(counts([["w1", 10]]), counts([["w1", 13]]));
    expect(drifts).toEqual([
      { bangumiId: "w1", previousCount: 10, currentCount: 13, driftRatio: 0.3 },
    ]);
  });

  it("stays silent at +20%", () => {
    expect(spotCountDrifts(counts([["w1", 10]]), counts([["w1", 12]]))).toEqual([]);
  });

  it("alerts at exactly −30% (a mass loss, signed ratio)", () => {
    const drifts = spotCountDrifts(counts([["w1", 10]]), counts([["w1", 7]]));
    expect(drifts).toEqual([
      { bangumiId: "w1", previousCount: 10, currentCount: 7, driftRatio: -0.3 },
    ]);
  });

  it("stays silent at −20%", () => {
    expect(spotCountDrifts(counts([["w1", 10]]), counts([["w1", 8]]))).toEqual([]);
  });

  it("alerts when a work's spots all vanish (−100%)", () => {
    const drifts = spotCountDrifts(counts([["w1", 10]]), counts([]));
    expect(drifts).toEqual([
      { bangumiId: "w1", previousCount: 10, currentCount: 0, driftRatio: -1 },
    ]);
  });

  it("never alerts from a zero baseline — first spots are growth, not drift", () => {
    expect(spotCountDrifts(counts([["w1", 0]]), counts([["w1", 12]]))).toEqual([]);
  });

  it("does not alert for a work that only now appeared (no baseline)", () => {
    expect(spotCountDrifts(counts([]), counts([["w1", 12]]))).toEqual([]);
  });

  it("honours a custom alert ratio", () => {
    const drifts = spotCountDrifts(counts([["w1", 10]]), counts([["w1", 14]]), 0.5);
    expect(drifts).toEqual([]);
  });
});
