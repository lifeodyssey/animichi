/** Pure percentile + sufficiency math for field vitals (issue #1010 AC5).
 * No DOM, no clock — fully deterministic and unit-testable. */
export type PercentileValues = readonly number[];

/** Nearest-rank q-th percentile: sorts ascending and picks index
 * Math.ceil((q / 100) * n) - 1, clamped to the array. Empty input -> null. */
export function percentile(values: PercentileValues, q: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((q / 100) * sorted.length) - 1;
  const index = Math.min(sorted.length - 1, Math.max(0, rank));
  // index is in range because values.length > 0 was already returned above;
  // the undefined check is only to satisfy noUncheckedIndexedAccess typing.
  return sorted[index] ?? null;
}

/** The 75th percentile — the p75 the release dashboard gates on. */
export function p75(values: PercentileValues): number | null {
  return percentile(values, 75);
}

/** The median (50th) — used by the lab CWV harness. */
export function median(values: PercentileValues): number | null {
  return percentile(values, 50);
}

/** RUM sample-size status. A field report with fewer than minValid valid
 * observations is explicitely INSUFFICIENT so it is never quoted as real. */
export type SampleStatus = "sufficient" | "insufficient";

export function sampleStatus(validCount: number, minValid: number): SampleStatus {
  return validCount >= minValid ? "sufficient" : "insufficient";
}
