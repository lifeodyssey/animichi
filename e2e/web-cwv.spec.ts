import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { webCwvConfig } from "../apps/web/web-cwv.config";

type CwvMetrics = { cls: number; lcp: number };

declare global {
  interface Window {
    __cwv?: CwvMetrics;
  }
}

test.use({
  baseURL: process.env.E2E_WEB_BASE_URL ?? new URL(webCwvConfig.url).origin,
});

const reportDir = join(__dirname, "..", "apps", "web", webCwvConfig.reportDir);

const initCwvMetrics = (): void => {
  Object.defineProperty(window, "__cwv", { value: { cls: 0, lcp: 0 } });
};

const observeCls = (): void => {
  const metrics = window.__cwv as CwvMetrics;
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      const shift = entry as LayoutShift;
      if (entry.entryType !== "layout-shift" || shift.hadRecentInput) continue;
      metrics.cls += shift.value;
    }
  }).observe({ type: "layout-shift", buffered: true });
};

const observeLcp = (): void => {
  const metrics = window.__cwv as CwvMetrics;
  new PerformanceObserver((list) => {
    const entries = list.getEntries();
    metrics.lcp = entries[entries.length - 1]?.startTime ?? 0;
  }).observe({ type: "largest-contentful-paint", buffered: true });
};

const installObservers = async (page: Page): Promise<void> => {
  await page.addInitScript(initCwvMetrics);
  await page.addInitScript(observeCls);
  await page.addInitScript(observeLcp);
};

const measureRun = async (page: Page): Promise<CwvMetrics> => {
  await page.goto("/", { waitUntil: "load" });
  await page.waitForFunction(() => (window.__cwv?.lcp ?? 0) > 0);
  return page.evaluate(() => ({
    cls: window.__cwv?.cls ?? 0,
    lcp: window.__cwv?.lcp ?? 0,
  }));
};

const writeRunReport = async (run: number, metrics: CwvMetrics): Promise<void> => {
  await mkdir(reportDir, { recursive: true });
  await writeFile(
    join(reportDir, `web-cwv-run-${run}.json`),
    JSON.stringify({ run, url: webCwvConfig.url, ...metrics }, null, 2),
  );
};

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

const warnIfLcpSlow = (lcp: number): void => {
  if (lcp <= webCwvConfig.thresholds.lcp.warn) return;
  const message = `median LCP ${lcp}ms exceeds ${webCwvConfig.thresholds.lcp.warn}ms warning threshold`;
  console.warn(message);
  test.info().annotations.push({ type: "warn", description: message });
};

const collectRuns = async (page: Page): Promise<CwvMetrics[]> => {
  const runs: CwvMetrics[] = [];
  for (let run = 1; run <= webCwvConfig.numberOfRuns; run++) {
    const metrics = await measureRun(page);
    await writeRunReport(run, metrics);
    runs.push(metrics);
  }
  return runs;
};

test("median CLS over 3 runs stays at or below the 0.1 good boundary", async ({ page }) => {
  await installObservers(page);
  const runs = await collectRuns(page);
  const cls = median(runs.map((run) => run.cls));
  const lcp = median(runs.map((run) => run.lcp));
  test.info().annotations.push({ type: "lcp", description: `median LCP ${lcp}ms` });
  warnIfLcpSlow(lcp);
  expect(cls).toBeLessThanOrEqual(webCwvConfig.thresholds.cls.error);
});
