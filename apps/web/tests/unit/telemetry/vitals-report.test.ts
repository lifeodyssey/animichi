/**
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import {
  buildFieldVitalsReport,
  buildLabVitalsReport,
  type VitalsSample,
} from "../../../src/features/telemetry/lib/vitals-report";

const MIN_VALID = 5;

function fieldSamples(): VitalsSample[] {
  return [
    { lcp: 900, inp: 120, cls: 0.02 },
    { lcp: 1100, inp: 150, cls: 0.03 },
    { lcp: 1300, inp: 180, cls: 0.04 },
    { lcp: 1500, inp: 210, cls: 0.05 },
    { lcp: 1700, inp: 240, cls: 0.06 },
    { lcp: 1900, inp: 300, cls: 0.08 },
  ];
}

describe("buildFieldVitalsReport (issue #1010 AC5 - RUM, never lab)", () => {
  it("aggregates per-metric p75 over real field samples", () => {
    const report = buildFieldVitalsReport(fieldSamples(), MIN_VALID);
    expect(report.lcp.p75).toBe(1700);
    expect(report.inp.p75).toBe(240);
    expect(report.cls.p75).toBe(0.06);
  });

  it("marks every metric sufficient above the sample floor", () => {
    const report = buildFieldVitalsReport(fieldSamples(), MIN_VALID);
    expect(report.lcp.status).toBe("sufficient");
    expect(report.inp.status).toBe("sufficient");
    expect(report.cls.status).toBe("sufficient");
  });

  it("explicitly marks insufficient samples instead of quoting them", () => {
    const report = buildFieldVitalsReport(fieldSamples().slice(0, 2), MIN_VALID);
    expect(report.lcp.status).toBe("insufficient");
    expect(report.inp.status).toBe("insufficient");
    expect(report.lcp.sampleCount).toBe(2);
  });

  it("counts only per-metric present samples (no input -> no INP)", () => {
    const mixed: VitalsSample[] = [
      { lcp: 800, cls: 0.01 },
      { lcp: 900, cls: 0.02 },
      { lcp: 1000, cls: 0.03 },
      { lcp: 1100, cls: 0.04 },
      { lcp: 1200, cls: 0.05 },
    ];
    const report = buildFieldVitalsReport(mixed, MIN_VALID);
    expect(report.lcp.sampleCount).toBe(5);
    expect(report.cls.sampleCount).toBe(5);
    expect(report.inp.sampleCount).toBe(0);
    expect(report.inp.p75).toBeNull();
    expect(report.inp.status).toBe("insufficient");
  });

  it("never quotes a p75 when no valid samples exist", () => {
    const report = buildFieldVitalsReport([{ lcp: NaN, cls: Number.POSITIVE_INFINITY }], MIN_VALID);
    expect(report.lcp.p75).toBeNull();
    expect(report.cls.p75).toBeNull();
  });
});

describe("buildLabVitalsReport (issue #1010 AC5 - lab is never RUM)", () => {
  it("labels a lab report as source lab, structurally distinct from field", () => {
    const lab = buildLabVitalsReport(fieldSamples(), MIN_VALID);
    expect(lab.lcp.source).toBe("lab");
    expect(lab.inp.source).toBe("lab");
    const field = buildFieldVitalsReport(fieldSamples(), MIN_VALID);
    expect(field.lcp.source).toBe("field");
    expect(lab.lcp.p75).toBe(field.lcp.p75);
    expect(lab.lcp.source).not.toBe(field.lcp.source);
  });
});
