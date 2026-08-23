import { expect, test, type Locator, type Page } from "@playwright/test";

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

/**
 * Owner 2026-08-23: the landing that used to carry the fixed day/night pill is
 * deleted, and `/` is a doorway that navigates itself away. The switch now
 * lives in the ⚙ settings panel, whose open state is URL-owned — so the panel's
 * own deep link is also the switch's address.
 */
const THEME_SWITCH_URL = "/chat?settings=byok";

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

/** Signed-out session stub shared by both ownership journeys. */
async function stubSignedOut(page: Page): Promise<void> {
  await page.route("**/api/auth/get-session", (route) =>
    route.fulfill({ status: 401, json: { error: "no session" } }),
  );
}

/**
 * The switch in its night position. The accessible NAME is deliberately the
 * same in both positions — renaming a control when its value changes makes it
 * a different control to a screen reader (WCAG 4.1.2) — so night/day is read
 * off `aria-checked`, the switch role's own state, and the stable name is
 * asserted alongside it.
 */
async function expectNight(toggle: Locator): Promise<void> {
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await expect(toggle).toHaveAccessibleName("夜間モード");
}

/** The switch in its day position — the OFF default. */
async function expectDay(toggle: Locator): Promise<void> {
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await expect(toggle).toHaveAccessibleName("夜間モード");
}

/**
 * AC3 — the stored theme is the single authority: after the seed the bootstrap
 * script applies night on the reload, the toggle reports it checked, a click
 * persists day, and a further reload honours that persisted day. The theme is
 * asserted through the switch's accessible state — `aria-checked` — never
 * through the `data-theme` implementation detail on `<html>`, and never
 * through the name, which stays put on purpose. The switch's `aria-checked`
 * flips to true only once React adopted the stored value, so awaiting it
 * doubles as the hydration barrier (clicking a pre-hydration toggle would
 * drop the handler).
 */
async function seededNightPage(page: Page): Promise<Locator> {
  await stubSignedOut(page);
  await page.route("https://challenges.cloudflare.com/**", (route) => route.abort());
  await page.route("**/healthz", (route) => route.fulfill({ json: { status: "ok" } }));
  await page.goto(THEME_SWITCH_URL);
  await seedNight(page);
  await page.reload();
  return page.getByRole("switch");
}

test("a seeded night theme survives a toggle to day and a reload", { tag: "@browser" }, async ({ page }) => {
  const toggle = await seededNightPage(page);
  await expectNight(toggle);
  await toggle.click();
  await expectDay(toggle);
  await page.reload();
  await expectDay(page.getByRole("switch"));
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
  await stubSignedOut(page);
  await page.route("**/healthz", (route) => route.fulfill({ json: { status: "ok" } }));
  const hydrated = page.waitForResponse((response) => response.url().includes("/healthz"));
  await page.goto("/chat?settings=byok");
  await hydrated;
}

async function reloadWaitingForHydration(page: Page): Promise<void> {
  const hydrated = page.waitForResponse((response) => response.url().includes("/healthz"));
  await page.reload();
  await hydrated;
}

/** The panel is visible and the URL still carries `?settings=byok`. */
async function expectOpenByokPanel(page: Page, panel: Locator): Promise<void> {
  await expect(panel).toBeVisible();
  await expect(page).toHaveURL(/\?settings=byok$/);
}

test("a URL-owned BYOK panel stays open across a reload", { tag: "@browser" }, async ({ page }) => {
  await openByokDeepLink(page);
  const panel = page.locator("#byok-settings-panel");
  await expectOpenByokPanel(page, panel);
  await reloadWaitingForHydration(page);
  await expectOpenByokPanel(page, panel);
});
