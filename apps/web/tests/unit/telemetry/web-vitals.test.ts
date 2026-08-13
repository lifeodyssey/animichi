/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  MIN_FIELD_SAMPLES,
  makeFieldReporter,
  mountFieldVitalsCollector,
  readFieldSamples,
  sampleFromInteraction,
  type FieldVitalsMount,
  type ObserverEntryLike,
  type VitalsSample,
  type WindowLike,
} from "../../../src/features/telemetry/lib/web-vitals";

describe("web-vitals field collector (issue #1010 AC5)", () => {
  it("converts an Event Timing interaction to an INP sample (used for p75)", () => {
    const sample = sampleFromInteraction({ entryType: "event", interactionId: 7, duration: 145 });
    expect(sample).toBe(145);
  });

  it("ignores non-interaction event entries (no interactionId)", () => {
    expect(sampleFromInteraction({ entryType: "event", duration: 90 })).toBeNull();
    expect(sampleFromInteraction({ entryType: "longtask", interactionId: 1 })).toBeNull();
  });

  it("reads collected field samples off the browser host", () => {
    const host = { __fieldVitals: [{ lcp: 1000 }, { lcp: 1200 }] };
    expect(readFieldSamples(host)).toEqual([{ lcp: 1000 }, { lcp: 1200 }]);
    expect(readFieldSamples({})).toBeNull();
  });

  it("reports a field p75 summary over the collected samples", () => {
    const samples: VitalsSample[] = Array.from({ length: MIN_FIELD_SAMPLES }, (_, i) => ({
      lcp: 1000 + i * 100,
      inp: 100 + i * 10,
      cls: 0.01 + i * 0.001,
    }));
    let invoked = false;
    const report = makeFieldReporter(samples, () => { invoked = true; });
    expect(invoked).toBe(true);
    expect(report.lcp.source).toBe("field");
    expect(report.lcp.status).toBe("sufficient");
    expect(report.lcp.sampleCount).toBe(MIN_FIELD_SAMPLES);
    expect(report.lcp.p75).toBeTypeOf("number");
  });
});

/** Deterministic stand-in for PerformanceObserver: records each observe() call
 * and lets a test feed entry batches back to the collector through emit(). */
class FakeObserver {
  static instances: FakeObserver[] = [];
  type: string | null = null;
  constructor(
    private readonly callback: (list: { getEntries: () => ObserverEntryLike[] }) => void,
  ) {}
  observe(options: { type: string; buffered: boolean }): void {
    this.type = options.type;
    FakeObserver.instances.push(this);
  }
  emit(entries: ObserverEntryLike[]): void {
    this.callback({ getEntries: () => entries });
  }
}

const ofType = (type: string): FakeObserver => {
  const found = FakeObserver.instances.find((observer) => observer.type === type);
  if (!found) throw new Error(`no observer registered for ${type}`);
  return found;
};

const host = (): WindowLike => ({ PerformanceObserver: FakeObserver });

const noop = (): void => undefined;

interface MountReturn {
  readonly mount: FieldVitalsMount;
  readonly win: WindowLike;
}

const mountOn = (win: WindowLike): MountReturn => {
  const mount = mountFieldVitalsCollector(win, noop);
  if (!mount) throw new Error("collector did not mount");
  return { mount, win };
};

describe("mountFieldVitalsCollector (issue #1010 AC5) — lifecycle", () => {
  beforeEach(() => {
    FakeObserver.instances = [];
  });

  it("returns null and never collects when the host has no PerformanceObserver", () => {
    const win: WindowLike = {};
    expect(mountFieldVitalsCollector(win, noop)).toBeNull();
    expect(win.__fieldVitals).toBeUndefined();
  });

  it("registers buffered observers for LCP, CLS and INP and aliases the samples", () => {
    const { mount, win } = mountOn(host());
    expect(FakeObserver.instances.map((observer) => observer.type)).toEqual([
      "largest-contentful-paint",
      "layout-shift",
      "event",
    ]);
    expect(win.__fieldVitals).toBe(mount.samples);
  });

  it("captures the most recent LCP startTime", () => {
    const { mount } = mountOn(host());
    ofType("largest-contentful-paint").emit([
      { entryType: "largest-contentful-paint", startTime: 420 },
      { entryType: "largest-contentful-paint", startTime: 910 },
    ]);
    expect(mount.samples).toEqual([{ lcp: 910 }]);
  });

  it("accumulates CLS and skips shifts caused by recent input", () => {
    const { mount } = mountOn(host());
    ofType("layout-shift").emit([
      { entryType: "layout-shift", value: 0.02 },
      { entryType: "layout-shift", value: 0.04, hadRecentInput: true },
    ]);
    ofType("layout-shift").emit([{ entryType: "layout-shift", value: 0.06 }]);
    expect(mount.samples).toEqual([{ cls: 0.08 }]);
  });

  it("records the slowest interaction as INP and ignores non-interactions", () => {
    const { mount } = mountOn(host());
    ofType("event").emit([
      { entryType: "event", interactionId: 1, duration: 90 },
      { entryType: "longtask", interactionId: 99 },
    ]);
    ofType("event").emit([{ entryType: "event", interactionId: 2, duration: 150 }]);
    expect(mount.samples).toEqual([{ inp: 150 }]);
  });
});

describe("mountFieldVitalsCollector (issue #1010 AC5) — defensive & reporting", () => {
  beforeEach(() => {
    FakeObserver.instances = [];
  });

  it("ignores empty and malformed entries so no metric is fabricated", () => {
    const { mount } = mountOn(host());
    ofType("largest-contentful-paint").emit([]);
    ofType("largest-contentful-paint").emit([{ entryType: "largest-contentful-paint" }]);
    ofType("layout-shift").emit([{ entryType: "layout-shift" }]);
    expect(mount.samples).toEqual([{}]);
  });

  it("finalize reports a field p75 summary from the collected samples", () => {
    const reports: number[] = [];
    const win: WindowLike = host();
    const mount = mountFieldVitalsCollector(win, (report) => {
      reports.push(report.lcp.p75 ?? -1);
    });
    if (!mount) throw new Error("collector did not mount");
    ofType("largest-contentful-paint").emit([
      { entryType: "largest-contentful-paint", startTime: 1450 },
    ]);
    mount.finalize();
    expect(reports).toEqual([1450]);
  });
});
