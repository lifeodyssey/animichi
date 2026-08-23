import AxeBuilder from "@axe-core/playwright";
import { describe, expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * Issue #1015 AC1: WCAG 2.2 AA on the five critical journeys. We inject
 * axe-core into each representative state and require ZERO serious or
 * critical violations (the WCAG AA bar). Moderate/minor findings are reported
 * but do not fail the gate; the HTML report documents them for triage.
 *
 * Transport is stubbed (the same contract-shaped fixtures the unit suite
 * uses) so the scans are hermetic — no live backend required.
 */
test.use({
  baseURL: process.env.E2E_WEB_BASE_URL ?? "http://localhost:3000",
  locale: "ja-JP",
  colorScheme: "light",
  reducedMotion: "no-preference",
  serviceWorkers: "block",
});

async function expectNoSeriousOrCritical(page: Page, label: string): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  const blocking = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(blocking, `${label}: axe serious/critical violations`).toEqual([]);
}

async function openChat(page: Page, path = "/chat"): Promise<void> {
  await page.route("https://challenges.cloudflare.com/**", (route) => route.abort());
  await page.route("**/api/auth/get-session", (route) =>
    route.fulfill({ status: 401, json: { error: "no session" } }),
  );
  await page.route("**/healthz", (route) => route.fulfill({ json: { status: "ok" } }));
  const healthy = page.waitForResponse((response) => response.url().includes("/healthz"));
  await page.goto(path);
  await healthy;
  await expect(page.getByRole("textbox")).toBeVisible();
}

async function navigateClient(page: Page, path: string, target: string): Promise<void> {
  const arrived = page.waitForURL((url) => url.pathname === path);
  await page.evaluate((next) => {
    const current = window.history.state ?? {};
    window.history.pushState({ ...current, __TSR_index: Number(current.__TSR_index ?? 0) + 1 }, "", next);
  }, path);
  await arrived;
  await expect(page.locator(target)).toBeVisible();
}

describe("WCAG 2.2 AA axe scan of the critical journeys", () => {
  test("doorway (`/`)", async ({ page }) => {
    await openChat(page, "/");
    await expect(page).toHaveURL(/\/chat(?:\?|$)/);
    await expectNoSeriousOrCritical(page, "doorway");
  });

  test("login modal", async ({ page }) => {
    await openChat(page, "/chat?settings=byok");
    await page.getByRole("button", { name: /ログインして設定|sign in to set up/i }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expectNoSeriousOrCritical(page, "login modal");
  });

  /**
   * The ⚙ settings panel itself: the new home of the day/night switch and the
   * language dropdown, both custom ARIA widgets that axe must clear.
   */
  test("settings panel", async ({ page }) => {
    await openChat(page, "/chat?settings=byok");
    await expect(page.locator(".app-splash")).toBeHidden();
    await expect(page.locator("#byok-settings-panel")).toBeVisible();
    await page.getByRole("combobox").click();
    await expect(page.getByRole("listbox")).toBeVisible();
    await page.locator("#settings-language-listbox").evaluate(async (menu) => {
      await Promise.all(menu.getAnimations().map((animation) => animation.finished));
    });
    await expectNoSeriousOrCritical(page, "settings panel");
  });

  test("chat", async ({ page }) => {
    await openChat(page);
    await expectNoSeriousOrCritical(page, "chat");
  });

  test("anime (empty overview)", async ({ page }) => {
    await page.route("**/catalog/public/anime-overview/*", (route) =>
      route.fulfill({
        json: {
          bangumi_id: "999",
          points_length: 0,
          circles: [],
          scenes: [],
          sample_itineraries: [],
        },
      }),
    );
    await openChat(page);
    await navigateClient(page, "/anime/999", ".anime-empty");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expectNoSeriousOrCritical(page, "anime empty");
  });

  test("route-detail (empty route)", async ({ page }) => {
    // The caller's saved routes include one empty draft route.
    await page.route("**/v1/users/saved-routes", (route) =>
      route.fulfill({
        json: {
          saved_routes: [
            {
              id: "22222222-2222-4222-8222-222222222222",
              title: "Blank draft",
              point_ids: [],
              status: "saved",
              saved_at: null,
              updated_at: "2026-07-18T00:00:00.000Z",
            },
          ],
        },
      }),
    );
    // planItinerary over zero points resolves to an empty itinerary.
    await page.route("**/catalog/itinerary", (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      return route.fulfill({
        json: {
          ordered_points: [],
          point_count: 0,
          timed_itinerary: { stops: [], legs: [], total_minutes: 0, total_distance_m: 0 },
        },
      });
    });
    await openChat(page);
    await navigateClient(page, "/routes/22222222-2222-4222-8222-222222222222", ".route-panel");
    await expect(page.getByRole("main")).toBeVisible();
    await expectNoSeriousOrCritical(page, "route-detail empty");
  });
});
