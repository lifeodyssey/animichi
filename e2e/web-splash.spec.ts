import { expect, test, type Page } from "@playwright/test";

const PROFILE = {
  downloadThroughput: 200_000,
  uploadThroughput: 93_750,
  latency: 150,
};

/**
 * The mobile index no longer clears the splash on its own: owner 2026-08-21 made
 * `/` dwell and then `replace` into `/chat`. The cold-start budget contract
 * ("the splash never delays first paint") is measured on `/privacy` instead — a
 * non-index route, so it keeps the plain 320ms get-in-get-out splash at the same
 * mobile viewport, under the same throttled cold start. The hand-off itself is
 * covered by its own case below.
 */
const COLD_START_ROUTE = "/privacy";

test.use({
  baseURL: process.env.E2E_WEB_BASE_URL ?? "http://localhost:3000",
  colorScheme: "light",
  serviceWorkers: "block",
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
});

async function applyPerfMobileCold(page: Page): Promise<void> {
  const client = await page.context().newCDPSession(page);
  await client.send("Network.enable");
  await client.send("Network.clearBrowserCache");
  await client.send("Network.setCacheDisabled", { cacheDisabled: true });
  await client.send("Network.emulateNetworkConditions", { offline: false, ...PROFILE, connectionType: "cellular3g" });
  await client.send("Emulation.setCPUThrottlingRate", { rate: 4 });
}

async function expectSplashWithinBudget(page: Page): Promise<void> {
  const startedAt = performance.now();
  await page.goto(COLD_START_ROUTE, { waitUntil: "commit" });
  await expect(page.locator('[data-splash="static"]')).toBeHidden({ timeout: 800 });
  expect(performance.now() - startedAt).toBeLessThanOrEqual(800);
  await expect(page.locator("main").first()).toBeVisible();
}

test("light system mode renders the day splash and clears it within 800ms", { tag: "@perf-mobile-cold" }, async ({ page }) => {
  await applyPerfMobileCold(page);
  await expectSplashWithinBudget(page);
  await expect(page.locator(".app-splash__frame.day")).toHaveCSS("display", "flex");
});

test.describe("dark system mode", () => {
  test.use({ colorScheme: "dark" });

  test("renders the night splash and clears it within 800ms", { tag: "@perf-mobile-cold" }, async ({ page }) => {
    await applyPerfMobileCold(page);
    await expectSplashWithinBudget(page);
    await expect(page.locator(".app-splash__frame.night")).toHaveCSS("display", "flex");
  });
});

test.describe("mobile index hand-off", () => {
  /**
   * Owner 2026-08-21: below 640px the index is a doorway, not a destination.
   * The splash is held up by `data-splash-dwell="mobile"` (which pushes the CSS
   * dismissal out to a bail-out delay) until the route leaves for /chat, so the
   * landing underneath is never flashed. Asserted through that attribute and the
   * resulting URL rather than any elapsed time.
   */
  test("the splash dwells over the landing and enters chat", async ({ page }) => {
    await page.goto("/", { waitUntil: "commit" });
    const splash = page.locator('[data-splash="static"]');
    await expect(splash).toBeVisible();
    await expect(splash).toHaveAttribute("data-splash-dwell", "mobile");
    await page.waitForURL("**/chat");
    await expect(page.locator("main.chat-page")).toBeVisible();
  });

  test("chat drops the dwell and dismisses the splash", async ({ page }) => {
    await page.goto("/", { waitUntil: "commit" });
    await page.waitForURL("**/chat");
    const splash = page.locator('[data-splash="static"]');
    await expect(splash).toBeAttached();
    await expect(splash).not.toHaveAttribute("data-splash-dwell", "mobile");
    await expect(splash).toBeHidden();
  });
});
