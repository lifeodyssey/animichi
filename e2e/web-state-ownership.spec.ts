import { expect, test, type Locator, type Page } from "@playwright/test";
import { chatDictFor } from "../apps/web/src/features/chat/i18n";
import { solveTurnstileEntry, stubTurnstileEntry } from "./helpers/turnstile";

/**
 * Issue #1009 AC3 + AC5 (parent spec #1004) browser evidence: the two durable
 * frontend state values keep exactly one owner. Day/night is owned by the
 * typed storage adapter (features/config/lib/theme-storage.ts), so a stored
 * night preference is adopted once and survives a toggle + reload. BYOK is a
 * stable settings-page anchor (`/settings#api-key`), not duplicated panel
 * state, and the route survives reload unchanged.
 *
 * The storage key is pinned here deliberately: it is the wire contract the
 * pre-hydration bootstrap script embeds, and importing the adapter under test
 * would let app and spec drift together (same rationale as
 * web-hero-query.spec.ts's pinned callback path).
 */
const THEME_STORAGE_KEY = "animichi-theme";
const ja = chatDictFor("ja");

/**
 * Owner 2026-08-23: the landing that used to carry the fixed day/night pill is
 * deleted, and `/` is a doorway that navigates itself away. The switch now
 * lives on the dedicated settings page.
 */
const THEME_SWITCH_URL = "/settings";

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

async function openAnonymousChat(page: Page): Promise<void> {
  await stubSignedOut(page);
  await stubTurnstileEntry(page);
  await page.route("**/healthz", (route) => route.fulfill({ json: { status: "ok" } }));
  const healthy = page.waitForResponse((response) => response.url().includes("/healthz"));
  await page.goto("/chat");
  await solveTurnstileEntry(page);
  await healthy;
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
 * The BYOK setup address is a real route plus an anchor, so no open/closed
 * state exists to synchronize. Anonymous auth is stubbed and the section is
 * asserted before and after reload.
 */
async function openByokDeepLink(page: Page): Promise<void> {
  await stubSignedOut(page);
  await page.goto("/settings#api-key");
  await expect(page.locator("#api-key")).toBeVisible();
}

async function expectByokDeepLink(page: Page, section: Locator): Promise<void> {
  await expect(section).toBeVisible();
  await expect(page).toHaveURL(/\/settings#api-key$/);
}

test("the stable BYOK settings deep link survives reload", { tag: "@browser" }, async ({ page }) => {
  await openByokDeepLink(page);
  const section = page.locator("#api-key");
  await expectByokDeepLink(page, section);
  await page.reload();
  await expectByokDeepLink(page, section);
});

test("the rightmost chat setting entry navigates to the dedicated page", { tag: "@browser" }, async ({ page }) => {
  await openAnonymousChat(page);
  const settings = page.getByRole("link", { name: ja.appbar.settings });
  await expect(settings).toHaveAttribute("href", "/settings");
  await expect(page.locator(".chat-appbar > :last-child")).toHaveAttribute("href", "/settings");
  await settings.click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.locator("main.settings-page")).toBeVisible();
});
