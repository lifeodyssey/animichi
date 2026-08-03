import { expect, test, type Page } from "@playwright/test";
import { readMapFrame, routeEmptyMap, routeRenderedMap, routeTileOutage } from "./fixtures/map-spike";

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

test("first real map tile paints within 3s under perf-mobile-cold", { tag: "@perf-mobile-cold" }, async ({ page }) => {
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

test("out-of-bounds 204 tiles paint only the plain background", async ({ page }) => {
  await routeEmptyMap(page);
  const emptyTile = page.waitForResponse((response) => response.url().endsWith(".mvt"));
  const startedAt = performance.now();
  await page.goto("/map-spike?source=worker", { waitUntil: "commit" });
  const response = await emptyTile;
  await expect(page.locator(".map-spike__stage")).toHaveAttribute("data-status", "ready");
  const elapsedMs = performance.now() - startedAt;
  await expect(page.locator(".map-spike__gl")).toHaveCSS("opacity", "1");
  const frame = await readMapFrame(page);
  expect(response.status()).toBe(204);
  expect(frame.sampledPixels).toBeGreaterThan(0);
  expect(frame.backgroundPixels).toBe(frame.sampledPixels);
  expect(frame.earthPixels).toBe(0);
  console.info(`[map-spike] out-of-bounds-background elapsed_ms=${elapsedMs.toFixed(1)}`);
});

async function expectIllustrationFallback(page: Page, status: 404 | 500): Promise<void> {
  await routeTileOutage(page, status);
  const failedAsset = page.waitForResponse((response) => response.url().includes("/tiles/"));
  const startedAt = performance.now();
  await page.goto("/map-spike?source=worker", { waitUntil: "commit" });
  const response = await failedAsset;
  const stage = page.locator(".map-spike__stage");
  await expect(stage).toHaveAttribute("data-status", "fallback");
  const elapsedMs = performance.now() - startedAt;
  const illustration = stage.getByRole("img", { name: "宇治エリアの巡礼ルート図" });
  await expect(illustration).toBeVisible();
  await expect(illustration.locator("polyline")).toHaveCount(1);
  await expect(illustration.locator("circle")).toHaveCount(5);
  await expect(stage.locator(".maplibregl-canvas")).toHaveCount(0);
  const box = await illustration.boundingBox();
  expect(box?.width ?? 0).toBeGreaterThan(300);
  expect(box?.height ?? 0).toBeGreaterThan(200);
  expect(response.status()).toBe(status);
  console.info(`[map-spike] tile-outage-${status.toString()} elapsed_ms=${elapsedMs.toFixed(1)}`);
}

test("404 tile outage visibly renders IllustrationBasemap", async ({ page }) => {
  await expectIllustrationFallback(page, 404);
});

test("500 tile outage visibly renders IllustrationBasemap", async ({ page }) => {
  await expectIllustrationFallback(page, 500);
});
