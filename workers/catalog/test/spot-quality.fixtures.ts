/**
 * Shared fixtures for the spot quality gate tests (X15 #285).
 *
 * Builds exported point rows, the Kyoto coordinate anchors used for the
 * dedupe-radius distances, and a recording SpotQualityAlerts seam.
 */
import type { ExportedSpotRow } from "../src/publish/candidate-export";
import type { SpotQualityAlerts, SpotQualityReport } from "../src/publish/spot-quality-gate";

/** Kyoto anchor: every other anchor is a pure northward latitude offset. */
export const KYOTO = { latitude: 35, longitude: 139 } as const;

/** ≈24.5 m north of KYOTO — inside the 25 m dedupe radius, outside a 24 m off-by-one. */
export const NORTH_24_5M = { latitude: 35.000220329, longitude: 139 } as const;

/** ≈26 m north of KYOTO — outside the 25 m dedupe radius. */
export const NORTH_26M = { latitude: 35.000233822, longitude: 139 } as const;

/** ≈48 m north of KYOTO and ≈23.5 m north of NORTH_24_5M — the transitive chain link. */
export const NORTH_48M = { latitude: 35.000431672, longitude: 139 } as const;

/** An exported point row with every column present, overridden per test. */
export function spotRow(overrides: Partial<ExportedSpotRow> & Pick<ExportedSpotRow, "id">): ExportedSpotRow {
  return {
    bangumiId: "w1",
    name: "Spot " + overrides.id,
    nameCn: null,
    latitude: KYOTO.latitude,
    longitude: KYOTO.longitude,
    image: null,
    episode: 1,
    timeSeconds: null,
    sceneDesc: null,
    origin: null,
    originUrl: null,
    city: "Kyoto",
    ...overrides,
  };
}

/** A recording alert seam: every quality report the gate raises, in order. */
export function driftRecorder(): { alerts: SpotQualityAlerts; reports: SpotQualityReport[] } {
  const reports: SpotQualityReport[] = [];
  return { alerts: { spotQualityReport: (report) => reports.push(report) }, reports };
}
