/** Field vs lab vitals reports (issue #1010 AC5). Pure aggregation with
 * explicit RUM/lab separation: lab data is NEVER reported as field, and a
 * sample set too small to be meaningful is marked insufficient, not quoted. */
import { type SampleStatus, p75, sampleStatus } from "./vitals-stats";

/** Real-user (field) or lab-harness source. */
export type DataSource = "field" | "lab";

/** One observed vitals reading. A metric is absent when the page did not emit
 * it (e.g. no interaction -> no INP), so summary must count per-metric. */
export interface VitalsSample {
  readonly lcp?: number;
  readonly inp?: number;
  readonly cls?: number;
}

export const VITALS_METRICS = ["lcp", "inp", "cls"] as const;

export type VitalsMetric = (typeof VITALS_METRICS)[number];

/** Per-metric aggregated summary for one source. */
export interface MetricSummary {
  readonly source: DataSource;
  readonly metric: VitalsMetric;
  readonly p75: number | null;
  readonly sampleCount: number;
  readonly status: SampleStatus;
  readonly minValid: number;
}

/** One summary per metric key (record shape, not an index signature). */
export type VitalsSummaryMap = Record<VitalsMetric, MetricSummary>;

function validValues(samples: readonly VitalsSample[], metric: VitalsMetric): number[] {
  const values: number[] = [];
  for (const sample of samples) {
    const value = sample[metric];
    if (typeof value === "number" && Number.isFinite(value)) values.push(value);
  }
  return values;
}

function summarizeOne(source: DataSource, metric: VitalsMetric,
  samples: readonly VitalsSample[], minValid: number): MetricSummary {
  const values = validValues(samples, metric);
  return { source, metric, sampleCount: values.length,
    p75: p75(values), status: sampleStatus(values.length, minValid), minValid };
}

/** Aggregates RUM samples into per-metric p75 summaries, marked sufficient or
 * explicitly insufficient. `minValid` is the floor for a trustworthy p75. */
export function buildFieldVitalsReport(samples: readonly VitalsSample[], minValid: number): VitalsSummaryMap {
  return {
    lcp: summarizeOne("field", "lcp", samples, minValid),
    inp: summarizeOne("field", "inp", samples, minValid),
    cls: summarizeOne("field", "cls", samples, minValid),
  };
}

/** The lab CWV harness produces lab-harness samples. Keeping a separate
 * builder means a consumer can never confuse lab data with RUM. */
export function buildLabVitalsReport(samples: readonly VitalsSample[], minValid: number): VitalsSummaryMap {
  return {
    lcp: summarizeOne("lab", "lcp", samples, minValid),
    inp: summarizeOne("lab", "inp", samples, minValid),
    cls: summarizeOne("lab", "cls", samples, minValid),
  };
}
