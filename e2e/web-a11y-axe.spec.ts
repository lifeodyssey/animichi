import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { navigateClient } from "./helpers/client-navigation";
import { solveTurnstileEntry, stubTurnstileEntry } from "./helpers/turnstile";

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
  contextOptions: { reducedMotion: "no-preference" },
  serviceWorkers: "block",
});

/**
 * Conformance is a property of the settled page.
 *
 * While the splash is dismissing it composites over everything beneath it and axe
 * reads the blend: `.route-map__stage` measured 4.37:1 in CI against the 4.645:1 its
 * tokens actually specify. Individual cases already waited for this; owning it here
 * means none can forget. `toBeHidden` also passes when the splash never mounted, so
 * gate-only scans are unaffected.
 *
 * Entrance fades are the same hazard one layer later: a subtree mid-fade
 * composites toward the page behind it and axe reads the blend — the route
 * card measured its pill at 4.37:1 and the stage copy at 3.69:1 in CI while
 * the tokens specify far higher pairs (both at exactly ~83% alpha, one shared
 * fading ancestor). Finite animations are therefore awaited here too;
 * infinite loops (the skeleton pulse) never settle and are excluded rather
 * than blocking the scan forever.
 */
async function expectPageSettled(page: Page): Promise<void> {
  await expect(page.locator(".app-splash")).toBeHidden();
  await page.evaluate(() => {
    const finite = document
      .getAnimations()
      .filter((animation) => animation.effect?.getTiming().iterations !== Infinity);
    return Promise.all(finite.map((animation) => animation.finished.catch(() => undefined)));
  });
}

async function expectNoSeriousOrCritical(page: Page, label: string, scope?: string): Promise<void> {
  await expectPageSettled(page);
  const builder = new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]);
  if (scope !== undefined) builder.include(scope);
  const results = await builder.analyze();
  const blocking = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(blocking, `${label}: axe serious/critical violations`).toEqual([]);
}

async function openChat(page: Page, path = "/chat"): Promise<void> {
  await stubTurnstileEntry(page);
  await page.route("**/api/auth/get-session", (route) =>
    route.fulfill({ status: 401, json: { error: "no session" } }),
  );
  await page.route("**/healthz", (route) => route.fulfill({ json: { status: "ok" } }));
  const healthy = page.waitForResponse((response) => response.url().includes("/healthz"));
  await page.goto(path);
  await solveTurnstileEntry(page);
  await healthy;
  await expect(page.getByRole("textbox")).toBeVisible();
}

async function openTurnstileGate(page: Page): Promise<void> {
  await page.route("https://challenges.cloudflare.com/**", (route) => route.abort());
  await page.route("**/api/auth/get-session", (route) =>
    route.fulfill({ status: 401, json: { error: "no session" } }),
  );
  await page.goto("/chat");
  await expect(page.locator(".turnstile-entry[data-active='true']")).toBeVisible();
}

test.describe("WCAG 2.2 AA axe scan of Turnstile", () => {
  test("Turnstile challenge gate", async ({ page }) => {
    await openTurnstileGate(page);
    await expectNoSeriousOrCritical(page, "Turnstile challenge gate");
  });

  test("Turnstile verifying gate", async ({ page }) => {
    await page.route("**/v1/turnstile/verify", () => new Promise(() => undefined));
    await openTurnstileGate(page);
    await solveTurnstileEntry(page);
    await expect(page.locator(".turnstile-entry")).toHaveAttribute("aria-busy", "true");
    await expectNoSeriousOrCritical(page, "Turnstile verifying gate");
  });

  test("Turnstile failure gate", async ({ page }) => {
    await page.route("**/v1/turnstile/verify", (route) => route.fulfill({ status: 403 }));
    await openTurnstileGate(page);
    await solveTurnstileEntry(page);
    await expect(page.getByRole("alert")).toBeVisible();
    await expectNoSeriousOrCritical(page, "Turnstile failure gate");
  });
});

test.describe("WCAG 2.2 AA axe scan of browser journeys", () => {
  test("doorway (`/`)", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".app-splash")).toBeHidden();
    // The postcard landing (2026-08-30) dropped the `.doorway` wrapper; the
    // search pill is its one action, so the boxed input is the ready signal.
    await expect(page.locator('form[action="/chat"] input[name="q"]')).toBeVisible();
    await expectNoSeriousOrCritical(page, "doorway");
  });

  test("login modal", async ({ page }) => {
    await openChat(page);
    await page.getByRole("button", { name: /^(ログイン|sign in)$/i }).click();
    await expect(page.getByRole("dialog", { name: /ログイン|sign in/i })).toBeVisible();
    await expectNoSeriousOrCritical(page, "login modal");
  });

  /** The dedicated settings page and its shared Radix-backed controls. */
  test("settings page", async ({ page }) => {
    await page.route("**/api/auth/get-session", (route) =>
      route.fulfill({ status: 401, json: { error: "no session" } }),
    );
    await page.goto("/settings#api-key");
    const splash = page.locator(".app-splash");
    await expect(splash).toHaveCount(1);
    await expect(splash).toBeHidden();
    await expect(page.getByRole("heading", { level: 1, name: "設定" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "APIキー" })).toBeVisible();
    const language = page.getByRole("combobox", { name: "言語" });
    await expect(language).toBeVisible();
    await expectNoSeriousOrCritical(page, "settings page");
    await language.click();
    await expect(page.getByRole("listbox")).toBeVisible();
    await page.locator(".animal-select-content").evaluate(async (menu) => {
      await Promise.all(menu.getAnimations().map((animation) => animation.finished));
    });
    await expectNoSeriousOrCritical(page, "settings language menu", ".animal-select-content");
  });

  test("chat", async ({ page }) => {
    await openChat(page);
    await expectNoSeriousOrCritical(page, "chat");
  });
});

test.describe("WCAG 2.2 AA axe scan of catalog journeys", () => {
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
});

test.describe("WCAG 2.2 AA axe scan of route journeys", () => {
  test("route-detail (empty route)", async ({ page }) => {
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
