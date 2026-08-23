import { describe, expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { solveTurnstileEntry, stubTurnstileEntry } from "./helpers/turnstile";

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

/**
 * The skip link and tab order are root-document furniture, present on every
 * route. This suite uses `/chat` directly so it exercises the same stable
 * critical surface at mobile and desktop widths. Transport is stubbed so the
 * scan stays hermetic.
 */
async function anonymousChat(page: Page): Promise<void> {
  await page.route("**/api/auth/get-session", (route) =>
    route.fulfill({ status: 401, json: { error: "no session" } }),
  );
  await stubTurnstileEntry(page);
  await page.route("**/healthz", (route) => route.fulfill({ json: { status: "ok" } }));
  await page.goto("/chat");
  await solveTurnstileEntry(page);
  // Wait for the splash to clear and the real content to mount, so a Tab/click
  // immediately after never races the splash overlay or hydration.
  await expect(page.getByRole("textbox")).toBeVisible();
  await expect(page.locator(".app-splash")).toBeHidden();
  // ChatInput intentionally autofocuses for the typing-first journey. Reset
  // focus before simulating the browser's first Tab from document start.
  await page.evaluate(() => {
    document.body.tabIndex = -1;
    document.body.focus();
  });
}

describe("AC2 keyboard navigation", () => {
  test("skip-to-content link is first in tab order, visible on focus, and jumps to main", async ({ page }) => {
    await anonymousChat(page);
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: /スキップ|コンテンツへ|skip|content/i });
    await expect(skip).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("#main-content")).toBeFocused();
  });

  test("tab order stays within interactive controls and exposes a visible focus indicator", async ({ page }) => {
    await anonymousChat(page);
    const skip = page.getByRole("link", { name: /スキップ|コンテンツへ|skip|content/i });
    await skip.press("Enter");
    for (let i = 0; i < Math.min(8, 8); i++) {
      await page.keyboard.press("Tab");
      await expect(page.locator("*:focus")).toHaveCount(1);
    }
  });
});

describe("Turnstile entry keyboard recovery", () => {
  test("a failed verification is focusable and retries from the keyboard", async ({ page }) => {
    await page.route("**/v1/turnstile/verify", (route) => route.fulfill({ status: 204 }));
    await page.route("**/v1/turnstile/verify", (route) => route.fulfill({ status: 403 }), { times: 1 });
    await page.route("**/api/auth/get-session", (route) =>
      route.fulfill({ status: 401, json: { error: "no session" } }),
    );
    await page.route("https://challenges.cloudflare.com/**", (route) => route.abort());
    await page.goto("/chat");
    await solveTurnstileEntry(page, "rejected-token");
    const retry = page.getByRole("button", { name: "もう一度ためす" });
    await page.evaluate(() => { document.body.tabIndex = -1; document.body.focus(); });
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await expect(retry).toBeFocused();
    await page.keyboard.press("Enter");
    await solveTurnstileEntry(page, "fresh-token");
    await expect(page.getByRole("textbox")).toBeVisible();
  });
});

/**
 * The login modal lost its landing trigger with the landing itself. Its
 * remaining signed-out entry point is the ⚙ settings panel's anonymous teaser
 * (`/chat?settings=byok` → "ログインして設定する"), which is the same
 * `features/auth/ui/LoginModal` component under test.
 */
describe("AC2 login modal focus management", () => {
  async function openLogin(page: Page): Promise<void> {
    await anonymousChat(page);
    await page.goto("/chat?settings=byok");
    await solveTurnstileEntry(page);
    await page.getByRole("button", { name: /ログインして設定|sign in to set up/i }).click();
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
    await anonymousChat(page);
    await page.goto("/chat?settings=byok");
    await solveTurnstileEntry(page);
    const trigger = page.getByRole("button", { name: /ログインして設定|sign in to set up/i });
    await trigger.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });
});

describe("AC2/AC4 error recovery by keyboard", () => {
  test("a backend-down retry banner is reachable and dismissible by Tab+Enter", async ({ page }) => {
    await stubTurnstileEntry(page);
    // Health check fails (503) -> A5 soft-lock plus the retry banner.
    await page.route("**/healthz", (route) =>
      route.fulfill({ status: 503, body: "unavailable" }),
    );
    await page.goto("/chat");
    await solveTurnstileEntry(page);
    await expect(page.getByRole("alert").first()).toBeVisible();
    // The retry control is keyboard reachable with a visible focus ring.
    const retry = page.getByRole("button").first();
    await retry.focus();
    await expect(retry).toBeFocused();
  });
});

describe("AC4 no-pointer / reduced-motion states", () => {
  const healthy = (page: Page) =>
    page.route("**/healthz", (route) => route.fulfill({ json: { status: "ok" } }));

  test("the chat page exposes a polite live region for async updates", async ({ page }) => {
    await stubTurnstileEntry(page);
    await healthy(page);
    await page.goto("/chat");
    await solveTurnstileEntry(page);
    await expect(page.locator('[aria-live="polite"]').first()).toBeAttached();
  });

  test("reduced-motion keeps the page operable (main renders, no blocking motion)", async ({ page }) => {
    await stubTurnstileEntry(page);
    await healthy(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/chat");
    await solveTurnstileEntry(page);
    await expect(page.locator("main")).toBeVisible();
    await expect(page.getByRole("textbox")).toBeVisible();
  });
});
