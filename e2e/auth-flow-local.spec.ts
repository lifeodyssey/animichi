import { test, expect } from "@playwright/test";
import { waitForMailpitEmail, extractMagicLink } from "./fixtures/mailpit";

/**
 * Local auth flow E2E test using Mailpit (supabase start).
 *
 * Prerequisites:
 * - supabase start (provides Mailpit at localhost:54324)
 * - frontend dev server at localhost:3001
 * - .env.local pointing to local Supabase (localhost:54321)
 */
const TEST_EMAIL = `e2e-${Date.now()}@seichijunrei.test`;

test.describe("Local auth flow via Mailpit", () => {
  test.slow();

  test("Login page: submit email → magic link arrives in Mailpit", async ({ page }) => {
    const beforeSend = new Date();

    await page.goto("/login?redirect=/chat");
    await expect(page.getByLabel(/email/i)).toBeVisible();

    // Submit test email
    await page.getByLabel(/email/i).fill(TEST_EMAIL);
    await page.getByRole("button", { name: /send|送信|发送/i }).click();

    // Should show "check email" confirmation
    await expect(
      page.getByText(/check.*email|メール.*確認|查收/i),
    ).toBeVisible({ timeout: 10_000 });

    // Wait for email in Mailpit
    const email = await waitForMailpitEmail(TEST_EMAIL, beforeSend);

    expect(email.Subject).toBeTruthy();
    expect(email.HTML).toBeTruthy();

    // Verify magic link exists
    const magicLink = extractMagicLink(email.HTML, "http://localhost:3001");
    expect(magicLink).toContain("token");
  });

  test("Magic link from Mailpit completes login → redirects to /chat", async ({ page }) => {
    const uniqueEmail = `e2e-full-${Date.now()}@seichijunrei.test`;
    const beforeSend = new Date();

    // Submit magic link
    await page.goto("/login?redirect=/chat");
    await page.getByLabel(/email/i).fill(uniqueEmail);
    await page.getByRole("button", { name: /send|送信|发送/i }).click();
    await expect(
      page.getByText(/check.*email|メール.*確認|查収/i),
    ).toBeVisible({ timeout: 10_000 });

    // Get magic link from Mailpit
    const email = await waitForMailpitEmail(uniqueEmail, beforeSend);
    const magicLink = extractMagicLink(email.HTML, "http://localhost:3001");

    // Visit magic link → should complete auth and redirect
    await page.goto(magicLink);
    await page.waitForURL(/\/chat/, { timeout: 15_000 });
    expect(page.url()).toContain("/chat");
  });

  test("Guide CTA: login modal → email → magic link → /chat with query", async ({ page }) => {
    const uniqueEmail = `e2e-guide-${Date.now()}@seichijunrei.test`;
    const beforeSend = new Date();

    // Go to Guide page
    await page.goto("/anime/485");
    await expect(page.getByRole("heading", { name: /涼宮ハルヒ/ })).toBeVisible();

    // Click CTA → login modal opens
    await page.getByRole("button", { name: /Plan route|ルートを計画|AIで/ }).click();
    await expect(page.getByRole("dialog")).toBeVisible();

    // Fill email in modal
    await page.getByLabel(/email/i).fill(uniqueEmail);
    await page.getByRole("button", { name: /send|送信|发送/i }).click();

    // Wait for email in Mailpit
    const email = await waitForMailpitEmail(uniqueEmail, beforeSend);
    const magicLink = extractMagicLink(email.HTML, "http://localhost:3001");

    // Visit magic link → should redirect to /chat?q=涼宮ハルヒ...
    await page.goto(magicLink);
    await page.waitForURL(/\/chat/, { timeout: 15_000 });
    expect(page.url()).toContain("/chat");
  });
});
