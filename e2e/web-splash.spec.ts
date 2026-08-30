import { expect, test, type Page } from "@playwright/test";
import { solveTurnstileEntry, stubTurnstileEntry } from "./helpers/turnstile";

const PROFILE = {
  downloadThroughput: 200_000,
  uploadThroughput: 93_750,
  latency: 150,
};

/**
 * On mobile `/` replaces itself with `/chat` on its first client effect, with
 * CSS holding the splash up until that navigation lands. The cold-start budget
 * contract ("the splash never delays first paint") is measured on `/privacy`
 * instead — a non-index route, so it keeps the plain 320ms get-in-get-out splash
 * at the same mobile viewport, under the same throttled cold start. The hand-off
 * itself is covered by its own cases below.
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

/**
 * `toBeHidden()` is satisfied by an element that does not exist yet, so polling
 * it straight after `commit` used to pass before the throttled HTML had even
 * arrived — the budget was never actually measured, and a splash left holding
 * on `/privacy` for 30s still went green (found 2026-08-23 by mutating the
 * root's `hold` prop to `true` for every route). Waiting for the splash to be
 * attached first makes the clock start at a moment the splash provably exists.
 */
async function expectSplashWithinBudget(page: Page): Promise<void> {
  await page.goto(COLD_START_ROUTE, { waitUntil: "commit" });
  const splash = page.locator('[data-splash="static"]');
  await expect(splash).toBeAttached();
  const startedAt = performance.now();
  await expect(splash).toBeHidden({ timeout: 800 });
  expect(performance.now() - startedAt).toBeLessThanOrEqual(800);
  await expect(page.locator("main").first()).toBeVisible();
}

/** The postcard-era splash (2026-08-30) is one frame for both themes — the
 * day/night split lives in `--color-ground` under `[data-theme="night"]`, not
 * in `.app-splash__frame.day/.night` markup. The theme itself comes only from
 * the stored preference (theme-bootstrap.ts); a system colour preference is
 * deliberately NOT consulted — "first visit defaults to day on both surfaces"
 * is the owner's design decision, so both system modes below must render the
 * day ground, and only a stored night choice renders the night ground. */
const DAY_SPLASH_GROUND = "rgb(110, 182, 142)";
const NIGHT_SPLASH_GROUND = "rgb(31, 61, 43)";

test("light system mode renders the day splash and clears it within 800ms", { tag: "@perf-mobile-cold" }, async ({ page }) => {
  await applyPerfMobileCold(page);
  await expectSplashWithinBudget(page);
  await expect(page.locator(".app-splash")).toHaveCSS("background-color", DAY_SPLASH_GROUND);
});

test.describe("dark system mode", () => {
  test.use({ colorScheme: "dark" });

  test("still renders the day splash — a system preference never flips the first visit", { tag: "@perf-mobile-cold" }, async ({ page }) => {
    await applyPerfMobileCold(page);
    await expectSplashWithinBudget(page);
    await expect(page.locator(".app-splash")).toHaveCSS("background-color", DAY_SPLASH_GROUND);
  });
});

test.describe("stored night preference", () => {
  test("renders the night splash and clears it within 800ms", { tag: "@perf-mobile-cold" }, async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("animichi-theme", "night"));
    await applyPerfMobileCold(page);
    await expectSplashWithinBudget(page);
    await expect(page.locator(".app-splash")).toHaveCSS("background-color", NIGHT_SPLASH_GROUND);
  });
});

test.describe("mobile index hand-off", () => {
  /**
   * The mobile index is a doorway, not a destination. There is no dwell — the
   * hand-off fires as soon as the client takes
   * over, and `data-splash-hold="handoff"` holds the CSS dismissal off until
   * chat's own first commit stamps `data-splash-release`, so the landing
   * underneath is never uncovered in between. Asserted through those marks and
   * the resulting URL, never elapsed time.
   */
  test("the splash covers / until chat replaces it", async ({ page }) => {
    await stubTurnstileEntry(page);
    await page.goto("/", { waitUntil: "commit" });
    const splash = page.locator('[data-splash="static"]');
    await expect(splash).toBeVisible();
    await expect(splash).toHaveAttribute("data-splash-hold", "handoff");
    await page.waitForURL("**/chat");
    await solveTurnstileEntry(page);
    await expect(page.locator("main.chat-page")).toBeVisible();
  });

  test("chat releases the splash once it has painted", async ({ page }) => {
    await stubTurnstileEntry(page);
    await page.goto("/", { waitUntil: "commit" });
    await page.waitForURL("**/chat");
    await solveTurnstileEntry(page);
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

async function shippedHoldRules(page: Page): Promise<readonly string[]> {
  return page.evaluate(() =>
    [...document.styleSheets]
      .flatMap((sheet) => [...sheet.cssRules])
      .map((rule) => rule.cssText)
      .filter((text) => text.includes("data-splash-mobile-handoff") && text.includes('data-splash-hold="handoff"')),
  );
}

/**
 * Desktop is a destination until the visitor activates the CTA. Its splash
 * uses the plain dismissal; only mobile receives the extended hand-off hold.
 */
test.describe("desktop index entry", () => {
  test.use({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });

  test("stays on / until the visitor activates the chat CTA", async ({ page }) => {
    await stubTurnstileEntry(page);
    await page.goto("/", { waitUntil: "commit" });
    const splash = page.locator('[data-splash="static"]');
    await expect(splash).toHaveAttribute("data-splash-hold", "handoff");
    await expect(splash).toBeHidden();
    await expect(page).toHaveURL(/\/$/);
    await page.setViewportSize({ width: 600, height: 1000 });
    await expect(splash).toBeHidden();
    await expect(page).toHaveURL(/\/$/);
    // The postcard landing's only plain /chat anchor is the login CTA in the
    // top bar (the search form submits, the chips carry ?q=) — 2026-08-30.
    await page.locator('a[href="/chat"]').click();
    await page.waitForURL("**/chat");
    await solveTurnstileEntry(page);
    await expect(page.locator("main.chat-page")).toBeVisible();
  });

  /** Asserted on the shipped stylesheet, not only the source contract. */
  test("ships the hand-off hold behind the immutable mobile mark", async ({ page }) => {
    await page.goto("/chat", { waitUntil: "load" });
    await expect.poll(async () => (await shippedHoldRules(page)).length).toBe(1);
  });
});
