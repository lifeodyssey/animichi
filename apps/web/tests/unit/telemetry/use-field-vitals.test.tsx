/**
 * @vitest-environment jsdom
 */
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useFieldVitals } from "../../../src/features/telemetry/lib/use-field-vitals";
import type {
  ObserverEntryLike,
  VitalsSample,
  VitalsSummaryMap,
} from "../../../src/features/telemetry/lib/web-vitals";

/** The globals the hook reads and the collector writes, projected onto the
 * jsdom window without leaning on lib.dom's real PerformanceObserver type. */
interface TestWindow {
  PerformanceObserver?: unknown;
  __fieldVitals?: VitalsSample[];
}

const testWindow = (): TestWindow => window;

/** Harness that exercises the hook in a client render. */
function Harness(): null {
  useFieldVitals();
  return null;
}

/** Deterministic PerformanceObserver whose registrations a test can drive. */
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

const withDebugSpy = () => vi.spyOn(console, "debug").mockImplementation(() => undefined);

const clearHost = () => {
  const win = testWindow();
  delete win.PerformanceObserver;
  delete win.__fieldVitals;
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  FakeObserver.instances = [];
  clearHost();
});

describe("useFieldVitals (issue #1010 AC5 mount)", () => {
  it("no-ops safely when the browser has no PerformanceObserver", () => {
    clearHost();
    render(<Harness />);
    expect(testWindow().__fieldVitals).toBeUndefined();
  });

  it("mounts observers and reports a field p75 report on pagehide", () => {
    clearHost();
    testWindow().PerformanceObserver = FakeObserver;
    const debug = withDebugSpy();
    render(<Harness />);
    ofType("largest-contentful-paint").emit([
      { entryType: "largest-contentful-paint", startTime: 1450 },
    ]);
    ofType("layout-shift").emit([{ entryType: "layout-shift", value: 0.05 }]);

    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });

    const fieldCall = debug.mock.calls.find((call) => call[0] === "[field-vitals]");
    expect(fieldCall).toBeDefined();
    const summary = (fieldCall ?? [])[1] as VitalsSummaryMap;
    expect(summary.lcp.p75).toBe(1450);
    expect(summary.cls.p75).toBe(0.05);
    expect(summary.inp.source).toBe("field");
  });

  it("does not report twice after the pagehide flush", () => {
    clearHost();
    testWindow().PerformanceObserver = FakeObserver;
    const debug = withDebugSpy();
    render(<Harness />);
    ofType("largest-contentful-paint").emit([
      { entryType: "largest-contentful-paint", startTime: 1200 },
    ]);
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    const fieldLogs = debug.mock.calls.filter((call) => call[0] === "[field-vitals]");
    expect(fieldLogs).toHaveLength(1);
  });
});
