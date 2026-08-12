import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * Issue #1009 AC3 + AC5 (parent spec #1004) browser evidence: the two durable
 * frontend state values keep exactly one owner. Day/night is owned by the
 * typed storage adapter (features/config/lib/theme-storage.ts), so a stored
 * night preference is adopted once and survives a toggle + reload; the BYOK
 * panel's open state is owned by the URL (`/chat?settings=byok`), so it opens
 * on arrival and survives reload with no second local authority.
 *
 * The storage key is pinned here deliberately: it is the wire contract the
 * pre-hydration bootstrap script embeds, and importing the adapter under test
 * would let app and spec drift together (same rationale as
 * web-hero-query.spec.ts's pinned callback path).
 */
const THEME_STORAGE_KEY = "animichi-theme";

test.use({
  baseURL: process.env.E2E_WEB_BASE_URL ?? "http://localhost:3000",
  locale: "ja-JP",
});

/**
 * Seed a night theme unconditionally, and only after the page has navigated:
 * the seed must not run before first load (that would let the app's own theme
 * choice be overwritten) and must not be conditional (a later persisted day
 * must survive the reload because it is the visitor's choice, not because the
 * seed happened to guard on the key).
 */
async function seedNight(page: Page): Promise<void> {
  await page.evaluate((key: string) => {
    window.localStorage.setItem(key, "night");
  }, THEME_STORAGE_KEY);
}

/**
 * AC3 — the stored theme is the single authority: after the seed the bootstrap
 * script applies night on the reload, the toggle reports it checked, a click
 * persists day, and a further reload honours that persisted day. The theme is
 * asserted through the toggle's accessible state — `aria-checked` (the switch
 * signal) and its locale-aware accessible name (夜/昼) — never through the
 * `data-theme` implementation detail on `<html>`. The toggle's `aria-checked`
 * flips to true only once React adopted the stored value, so awaiting it
 * doubles as the hydration barrier (clicking a pre-hydration toggle would
 * drop the handler).
 */
test("a seeded night theme survives a toggle to day and a reload", { tag: "@browser" }, async ({ page }) => {
  await page.route("**/api/auth/get-session", (route) =>
    route.fulfill({ status: 401, json: { error: "no session" } }),
  );
  await page.goto("/");
  await seedNight(page);
  await page.reload();

  const toggle = page.getByRole("switch");
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await expect(toggle).toHaveAccessibleName("夜");

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await expect(toggle).toHaveAccessibleName("昼");

  await page.reload();
  await expect(page.getByRole("switch")).toHaveAttribute("aria-checked", "false");
  await expect(page.getByRole("switch")).toHaveAccessibleName("昼");
});

/**
 * AC5 — the BYOK panel's open state is URL-owned: `?settings=byok` opens it on
 * arrival, and a reload keeps it open with the query untouched. Hermetic: auth
 * is a stubbed 401 (anonymous teaser inside the panel), healthz is a stubbed
 * ok response, and the Turnstile loader is aborted — nothing reaches a live
 * service. The healthz response only fires from the hydrated client, so
 * awaiting it (before and after reload) proves the assertions run on real
 * post-hydration state.
 */
async function openByokDeepLink(page: Page): Promise<void> {
  await page.route("https://challenges.cloudflare.com/**", (route) => route.abort());
  await page.route("**/api/auth/get-session", (route) =>
    route.fulfill({ status: 401, json: { error: "no session" } }),
  );
  await page.route("**/healthz", (route) => route.fulfill({ json: { status: "ok" } }));
  const hydrated = page.waitForResponse((response) => response.url().includes("/healthz"));
  await page.goto("/chat?settings=byok");
  await hydrated;
}

test("a URL-owned BYOK panel stays open across a reload", { tag: "@browser" }, async ({ page }) => {
  await openByokDeepLink(page);

  const panel = page.locator("#byok-settings-panel");
  await expect(panel).toBeVisible();
  await expect(page).toHaveURL(/\?settings=byok$/);

  const rehydrated = page.waitForResponse((response) => response.url().includes("/healthz"));
  await page.reload();
  await rehydrated;

  await expect(panel).toBeVisible();
  await expect(page).toHaveURL(/\?settings=byok$/);
});
