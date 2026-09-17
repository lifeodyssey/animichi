/**
 * Spot quality gate composite tests (X15 #285).
 *
 * Drives gateSpotRows over exported point rows: coordinate rejections,
 * same-episode duplicate merges, and drift alerts raised through the
 * injected SpotQualityAlerts seam. Publishable rows leave the gate verbatim
 * — the gate decides, it does not rebuild.
 */
import { describe, expect, it, vi } from "vitest";
import {
  consoleSpotQualityAlerts,
  gateSpotRows,
  type SpotQualityReport,
} from "../src/publish/spot-quality-gate";
import type { ExportedSpotRow } from "../src/publish/candidate-export";
import {
  KYOTO,
  NORTH_24_5M,
  driftRecorder,
  spotRow,
} from "./spot-quality.fixtures";

function spreadRows(count: number): ExportedSpotRow[] {
  return Array.from({ length: count }, (_item, index) =>
    spotRow({ id: "p-" + String(index).padStart(2, "0"), latitude: 35 + index * 0.001 }));
}

describe("gateSpotRows (rejection and merge)", () => {
  it("rejects unpublishable coordinates and keeps valid rows in input order", () => {
    const rows = [
      spotRow({ id: "p-good", latitude: 35, longitude: 139 }),
      spotRow({ id: "p-null", latitude: 0, longitude: 0 }),
      spotRow({ id: "p-later", latitude: 35.5, longitude: 139.5 }),
    ];
    const recorder = driftRecorder();
    const gated = gateSpotRows(rows, new Map(), recorder.alerts);
    expect(gated.publishable.map((row) => row.id)).toEqual(["p-good", "p-later"]);
    expect(recorder.reports[0]?.rejectedSpots).toEqual([
      { spotId: "p-null", bangumiId: "w1", reason: "unpublishable-coordinates" },
    ]);
  });

  it("merges same-episode duplicates within the radius and reports the merge", () => {
    const rows = [
      spotRow({ id: "p-a", latitude: KYOTO.latitude, longitude: KYOTO.longitude, episode: 3 }),
      spotRow({ id: "p-b", latitude: NORTH_24_5M.latitude, longitude: NORTH_24_5M.longitude, episode: 3 }),
      spotRow({ id: "p-c", latitude: KYOTO.latitude, longitude: KYOTO.longitude, episode: 4 }),
    ];
    const recorder = driftRecorder();
    const gated = gateSpotRows(rows, new Map(), recorder.alerts);
    expect(gated.publishable.map((row) => row.id)).toEqual(["p-a", "p-c"]);
    expect(recorder.reports[0]?.duplicateMerges).toEqual([
      { keptSpotId: "p-a", mergedSpotIds: ["p-b"] },
    ]);
  });
});

describe("gateSpotRows (alerts and pass-through)", () => {
  it("raises the drift alert through the injected seam, never silently", () => {
    const previousCounts = new Map([["w1", 10]]);
    const recorder = driftRecorder();
    const gated = gateSpotRows(spreadRows(13), previousCounts, recorder.alerts);
    expect(gated.publishable).toHaveLength(13);
    expect(recorder.reports[0]?.spotCountDrifts).toEqual([
      { bangumiId: "w1", previousCount: 10, currentCount: 13, driftRatio: 0.3 },
    ]);
  });

  it("publishes the rows verbatim — the gate decides without rebuilding", () => {
    const rows = [spotRow({ id: "p-a" })];
    const gated = gateSpotRows(rows, new Map(), driftRecorder().alerts);
    expect(gated.publishable[0]).toBe(rows[0]);
  });

  it("passes an empty spot set uneventfully — zero rejections, merges, or drifts", () => {
    const recorder = driftRecorder();
    const gated = gateSpotRows([], new Map(), recorder.alerts);
    expect(gated.publishable).toEqual([]);
    const expected: SpotQualityReport = {
      rejectedSpots: [],
      duplicateMerges: [],
      spotCountDrifts: [],
    };
    expect(recorder.reports).toEqual([expected]);
  });
});

describe("consoleSpotQualityAlerts (the default alert seam)", () => {
  it("warns one line per rejection, merge, and drift", () => {
    const report: SpotQualityReport = {
      rejectedSpots: [{ spotId: "p-x", bangumiId: "w1", reason: "unpublishable-coordinates" }],
      duplicateMerges: [{ keptSpotId: "p-a", mergedSpotIds: ["p-b", "p-c"] }],
      spotCountDrifts: [{ bangumiId: "w1", previousCount: 10, currentCount: 3, driftRatio: -0.7 }],
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    consoleSpotQualityAlerts().spotQualityReport(report);
    expect(warn).toHaveBeenCalledTimes(3);
    const warnings = warn.mock.calls as [string][];
    const [rejection, merge, drift] = warnings.map((call) => call[0]);
    expect(rejection).toContain("p-x");
    expect(rejection).toContain("unpublishable-coordinates");
    expect(merge).toContain("p-a");
    expect(merge).toContain("2");
    expect(drift).toContain("w1");
    expect(drift).toContain("10");
    expect(drift).toContain("3");
    expect(drift).toContain("-70");
    warn.mockRestore();
  });

  it("stays silent for an all-clear report", () => {
    const report: SpotQualityReport = { rejectedSpots: [], duplicateMerges: [], spotCountDrifts: [] };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    consoleSpotQualityAlerts().spotQualityReport(report);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
