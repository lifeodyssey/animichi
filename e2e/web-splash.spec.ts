import { expect, test, type Page } from "@playwright/test";

const PROFILE = {
  downloadThroughput: 200_000,
  uploadThroughput: 93_750,
  latency: 150,
};

/**
 * The mobile index no longer clears the splash on its own: owner 2026-08-22 made
 * `/` `replace` into `/chat` on its first client effect, with CSS holding the
 * splash up until that navigation lands. The cold-start budget contract ("the
 * splash never delays first paint") is measured on `/privacy` instead — a
 * non-index route, so it keeps the plain 320ms get-in-get-out splash at the same
 * mobile viewport, under the same throttled cold start. The hand-off itself is
 * covered by its own cases below.
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
   * Owner 2026-08-23: below 640px the index is a doorway, not a destination.
   * There is no dwell — the hand-off fires as soon as the client takes over,
   * and `data-splash-hold="mobile"` holds the CSS dismissal off until chat's
   * own first commit stamps `data-splash-release`, so the page underneath is
   * never uncovered in between. Asserted through those marks and the resulting
   * URL, never elapsed time.
   */
  test("the splash covers / until chat replaces it", async ({ page }) => {
    await page.goto("/", { waitUntil: "commit" });
    const splash = page.locator('[data-splash="static"]');
    await expect(splash).toBeVisible();
    await expect(splash).toHaveAttribute("data-splash-hold", "mobile");
    await page.waitForURL("**/chat");
    await expect(page.locator("main.chat-page")).toBeVisible();
  });

  test("chat releases the splash once it has painted", async ({ page }) => {
    await page.goto("/", { waitUntil: "commit" });
    await page.waitForURL("**/chat");
    await expect(page.locator("main.chat-page")).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-splash-release", "");
    const splash = page.locator('[data-splash="static"]');
    await expect(splash).toBeAttached();
    await expect(splash).toBeHidden();
  });

  /** `replace`, not `push`: Back must leave the app, not bounce off `/` into chat again. */
  test("leaves no / entry behind for the Back button", async ({ page }) => {
    await page.goto("/privacy", { waitUntil: "commit" });
    await page.goto("/", { waitUntil: "commit" });
    await page.waitForURL("**/chat");
    await page.goBack();
    await expect(page).toHaveURL(/\/privacy$/);
  });
});
