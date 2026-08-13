/**
 * Browser field-vitals collector (issue #1010 AC5). Wires PerformanceObserver
 * to real-user LCP/INP/CLS, aggregates to a p75 field report via
 * buildFieldVitalsReport, and hands it to a reporter callback.
 *
 * Testability: the ObserverCtor + WindowLike environment are injectable so
 * unit tests supply deterministic observers without a browser clock.
 * The report it produces is EXPLICITLY field (RUM) — lab data is never mixed.
 */
import {
  buildFieldVitalsReport,
  type VitalsSample,
  type VitalsSummaryMap,
} from "./vitals-report";

export type { VitalsSample, VitalsSummaryMap };

export interface ObserverEntryLike {
  readonly entryType: string;
  readonly startTime?: number;
  readonly value?: number;
  readonly duration?: number;
  readonly hadRecentInput?: boolean;
  readonly interactionId?: number;
}

export interface FieldObserverHost {
  readonly observe: (options: { type: string; buffered: boolean }) => void;
}

export type ObserverCtor = new (
  callback: (list: { getEntries: () => ObserverEntryLike[] }) => void,
) => FieldObserverHost;

export interface WindowLike {
  readonly PerformanceObserver?: ObserverCtor;
  __fieldVitals?: VitalsSample[];
}

/** Mutable page-view metric slot scribed by the observers before reporting. */
interface MutableSample {
  lcp?: number;
  cls?: number;
  inp?: number;
}

export const MIN_FIELD_SAMPLES = 10;

/** Polls window.__fieldVitals once; null when the collector never mounted.
 * Defined on WindowLike to stay jsdom-safe in unit tests. */
export function readFieldSamples(win: WindowLike): VitalsSample[] | null {
  return win.__fieldVitals ?? null;
}

/** Builder for an INP sample from an Event Timing entry (processing duration). */
export function sampleFromInteraction(entry: ObserverEntryLike): number | null {
  if (entry.entryType !== "event" || !entry.interactionId) return null;
  return typeof entry.duration === "number" ? entry.duration : null;
}

/** Collect-and-report one field vitals summary; returns it so callers and
 * tests take the report without a cast. */
export function makeFieldReporter(
  samples: readonly VitalsSample[],
  reportField: (report: VitalsSummaryMap) => void,
): VitalsSummaryMap {
  const report = buildFieldVitalsReport(samples, MIN_FIELD_SAMPLES);
  reportField(report);
  return report;
}

/** Handle a mounted collector: the accumulating samples and a way to flush
 * them into a p75 field report for the reporter callback. */
export interface FieldVitalsMount {
  readonly samples: VitalsSample[];
  readonly finalize: () => VitalsSummaryMap;
}

/** LCP is the largest-contentful-paint startTime of the most recent entry. */
function lcpValue(entries: readonly ObserverEntryLike[]): number | null {
  const last = entries[entries.length - 1];
  if (!last) return null;
  return typeof last.startTime === "number" ? last.startTime : null;
}

/** CLS only counts layout shifts without recent input; each shifted delta
 * adds to the running page total. */
function clsDelta(entry: ObserverEntryLike): number | null {
  if (entry.hadRecentInput) return null;
  return typeof entry.value === "number" ? entry.value : null;
}

function collectLcp(sample: MutableSample, entries: readonly ObserverEntryLike[]): void {
  const lcp = lcpValue(entries);
  if (lcp !== null) sample.lcp = lcp;
}

function collectCls(sample: MutableSample, entries: readonly ObserverEntryLike[]): void {
  for (const entry of entries) {
    const delta = clsDelta(entry);
    if (delta !== null) sample.cls = (sample.cls ?? 0) + delta;
  }
}

function collectInp(sample: MutableSample, entries: readonly ObserverEntryLike[]): void {
  for (const entry of entries) {
    const duration = sampleFromInteraction(entry);
    if (duration !== null) sample.inp = Math.max(sample.inp ?? 0, duration);
  }
}

function registerObserver(
  observer: ObserverCtor,
  type: string,
  sample: MutableSample,
  apply: (sample: MutableSample, entries: readonly ObserverEntryLike[]) => void,
): void {
  new observer((list) => {
    apply(sample, list.getEntries());
  }).observe({ type, buffered: true });
}

function registerFieldObservers(observer: ObserverCtor, sample: MutableSample): void {
  registerObserver(observer, "largest-contentful-paint", sample, collectLcp);
  registerObserver(observer, "layout-shift", sample, collectCls);
  registerObserver(observer, "event", sample, collectInp);
}

function mountObservers(observer: ObserverCtor, win: WindowLike): MutableSample[] {
  const sample: MutableSample = {};
  const samples = [sample];
  win.__fieldVitals = samples;
  registerFieldObservers(observer, sample);
  return samples;
}

/** Registers the LCP/INP/CLS observers on the host and exposes the live
 * samples plus a finalize() that reports once. Returns null (no-op) when the
 * host has no PerformanceObserver, so SSR and jsdom stay safe. */
export function mountFieldVitalsCollector(
  win: WindowLike,
  reportField: (report: VitalsSummaryMap) => void,
): FieldVitalsMount | null {
  const Observer = win.PerformanceObserver;
  if (!Observer) return null;
  const samples = mountObservers(Observer, win);
  return { samples, finalize: () => makeFieldReporter(samples, reportField) };
}
