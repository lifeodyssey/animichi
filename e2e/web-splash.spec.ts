import { expect, test, type Page } from "@playwright/test";

const PROFILE = {
  downloadThroughput: 200_000,
  uploadThroughput: 93_750,
  latency: 150,
};

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
  await page.goto("/", { waitUntil: "commit" });
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
