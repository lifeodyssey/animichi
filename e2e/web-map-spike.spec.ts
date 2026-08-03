import { expect, test, type Page } from "@playwright/test";
import { readMapFrame, routeRenderedMap } from "./fixtures/map-spike";

const FIRST_TILE_BUDGET_MS = 3_000;
const PROFILE = {
  downloadThroughput: 200_000,
  uploadThroughput: 93_750,
  latency: 150,
};

test.use({
  baseURL: process.env.E2E_WEB_BASE_URL ?? "http://localhost:3000",
  colorScheme: "light",
  deviceScaleFactor: 2,
  launchOptions: {
    args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--use-gl=angle"],
  },
  serviceWorkers: "block",
  viewport: { width: 390, height: 844 },
});

async function applyPerfMobileCold(page: Page): Promise<void> {
  const client = await page.context().newCDPSession(page);
  await client.send("Network.enable");
  await client.send("Network.clearBrowserCache");
  await client.send("Network.setCacheDisabled", { cacheDisabled: true });
  await client.send("Network.emulateNetworkConditions", { offline: false, ...PROFILE, connectionType: "cellular3g" });
  await client.send("Emulation.setCPUThrottlingRate", { rate: 4 });
}

test("first real map tile paints within 3s under perf-mobile-cold", async ({ page }) => {
  await routeRenderedMap(page);
  await applyPerfMobileCold(page);
  const startedAt = performance.now();
  await page.goto("/map-spike?source=worker", { waitUntil: "commit" });
  const stage = page.locator(".map-spike__stage");
  await expect(stage).toHaveAttribute("data-status", "ready", { timeout: FIRST_TILE_BUDGET_MS });
  const elapsedMs = performance.now() - startedAt;
  await expect(page.locator(".map-spike__gl")).toHaveCSS("opacity", "1");
  const frame = await readMapFrame(page);
  expect(frame.earthPixels).toBeGreaterThan(0);
  expect(frame.renderer).toContain("SwiftShader");
  expect(elapsedMs).toBeLessThanOrEqual(FIRST_TILE_BUDGET_MS);
  console.info(`[map-spike] first-tile elapsed_ms=${elapsedMs.toFixed(1)}`);
});
