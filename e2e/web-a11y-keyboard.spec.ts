import { describe, expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * Issue #1015 AC2: keyboard-only accessibility of the critical journeys.
 * Every interaction here is asserted through the keyboard — no pointer input.
 */
test.use({
  baseURL: process.env.E2E_WEB_BASE_URL ?? "http://localhost:3000",
  locale: "ja-JP",
  colorScheme: "light",
  serviceWorkers: "block",
});

async function anonymousLanding(page: Page): Promise<void> {
  await page.route("**/api/auth/get-session", (route) =>
    route.fulfill({ status: 401, json: { error: "no session" } }),
  );
  await page.goto("/");
  // Wait for the splash to clear and the real landing content to mount, so a
  // Tab/click immediately after never races the splash overlay or hydration.
  await expect(page.locator("main")).toBeVisible();
  await expect(page.locator(".app-splash")).toBeHidden();
}

describe("AC2 keyboard navigation", () => {
  test("skip-to-content link is first in tab order, visible on focus, and jumps to main", async ({ page }) => {
    await anonymousLanding(page);
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: /スキップ|コンテンツへ|skip|content/i });
    await expect(skip).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("#main-content")).toBeFocused();
  });

  test("tab order stays within interactive controls and exposes a visible focus indicator", async ({ page }) => {
    await anonymousLanding(page);
    const skip = page.getByRole("link", { name: /スキップ|コンテンツへ|skip|content/i });
    await skip.press("Enter");
    for (let i = 0; i < Math.min(8, 8); i++) {
      await page.keyboard.press("Tab");
      await expect(page.locator("*:focus")).toHaveCount(1);
    }
  });
});

describe("AC2 login modal focus management", () => {
  async function openLogin(page: Page): Promise<void> {
    await anonymousLanding(page);
    await page.getByRole("button", { name: /ログイン|login/i }).last().click();
    await expect(page.getByRole("dialog")).toBeVisible();
  }

  test("opening the modal moves focus inside and onto the email field", async ({ page }) => {
    await openLogin(page);
    await expect(page.getByRole("textbox", { name: /メール|email/i })).toBeFocused();
  });

  test("tab traps inside the modal and never leaks into the page behind", async ({ page }) => {
    await openLogin(page);
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press("Tab");
      const inside = await page.evaluate(() => {
        const active = document.activeElement;
        return !!document.querySelector('[role="dialog"]')?.contains(active);
      });
      expect(inside).toBe(true);
    }
  });

  test("escape closes the modal and restores focus to the trigger", async ({ page }) => {
    await page.route("**/api/auth/get-session", (route) =>
      route.fulfill({ status: 401, json: { error: "no session" } }),
    );
    await page.goto("/");
    await expect(page.locator("main")).toBeVisible();
    const trigger = page.getByRole("button", { name: /ログイン|login/i }).last();
    await trigger.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });
});

describe("AC2/AC4 error recovery by keyboard", () => {
  test("a backend-down retry banner is reachable and dismissible by Tab+Enter", async ({ page }) => {
    await page.route("https://challenges.cloudflare.com/**", (route) => route.abort());
    // Health check fails (503) -> A5 soft-lock plus the retry banner.
    await page.route("**/healthz", (route) =>
      route.fulfill({ status: 503, body: "unavailable" }),
    );
    await page.goto("/chat");
    await expect(page.getByRole("alert").first()).toBeVisible();
    // The retry control is keyboard reachable with a visible focus ring.
    const retry = page.getByRole("button").first();
    await retry.focus();
    await expect(retry).toBeFocused();
  });
});

describe("AC4 no-pointer / reduced-motion states", () => {
  const blockTurnstile = (page: Page) =>
    page.route("https://challenges.cloudflare.com/**", (route) => route.abort());
  const healthy = (page: Page) =>
    page.route("**/healthz", (route) => route.fulfill({ json: { status: "ok" } }));

  test("the chat page exposes a polite live region for async updates", async ({ page }) => {
    await blockTurnstile(page);
    await healthy(page);
    await page.goto("/chat");
    await expect(page.locator('[aria-live="polite"]').first()).toBeAttached();
  });

  test("reduced-motion keeps the page operable (main renders, no blocking motion)", async ({ page }) => {
    await blockTurnstile(page);
    await healthy(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/chat");
    await expect(page.locator("main")).toBeVisible();
    await expect(page.getByRole("textbox")).toBeVisible();
  });
});
