/**
 * Client-only React binding for the field-vitals collector (issue #1010 AC5).
 * Mounts the LCP/INP/CLS PerformanceObservers once on the browser and flushes
 * a p75 field report to an observable sink on pagehide.
 *
 * SSR-safe: this hook never runs on the server (effects are client-only), and
 * the collector itself no-ops whenever PerformanceObserver is absent, so a
 * jsdom unit render cannot crash. No backend is invented here — with no RUM
 * endpoint wired, the report is logged at debug level for an operator to watch
 * from a production console even before it reaches a dashboard.
 */
import { useEffect } from "react";
import {
  mountFieldVitalsCollector,
  type VitalsSummaryMap,
} from "./web-vitals";

/** Observable sink for the field report; today it is a debug log until a RUM
 * endpoint exists. Separated so a test can spy on the exact call. */
export function reportFieldVitals(report: VitalsSummaryMap): void {
  console.debug("[field-vitals]", report);
}

/** Mount the collector for the lifetime of the root layout and flush it when
 * the page hides, so a real-user p75 report is produced exactly once. */
export function useFieldVitals(): void {
  useEffect(() => {
    const mount = mountFieldVitalsCollector(window, reportFieldVitals);
    if (!mount) return;
    window.addEventListener("pagehide", mount.finalize, { once: true });
    return () => {
      window.removeEventListener("pagehide", mount.finalize);
    };
  }, []);
}
