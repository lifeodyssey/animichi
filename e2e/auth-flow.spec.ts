import { test, expect } from "@playwright/test";
import { waitForEmail, extractMagicLink, verifyEmailLocale, MAILBOX } from "./fixtures/mails";

/**
 * Full auth flow E2E test.
 * Requires:
 * - Local dev server running at localhost:3001
 * - Supabase running locally (supabase start) OR production Supabase configured
 * - mails CLI configured with API key (mails config set api_key ...)
 *
 * This test walks the REAL auth path:
 * 1. Submit email → Supabase sends magic link → mails.dev receives it
 * 2. Verify email content (locale)
 * 3. Extract magic link → browser visits it
 * 4. Verify redirect to /chat
 */
test.describe("Full auth flow via mails.dev", () => {
  // Mark as slow — email delivery takes time
  test.slow();

  test("Login page: submit email → receive magic link → verify locale", async ({ page }) => {
    const beforeSend = new Date();

    // Go to login page
    await page.goto("/login?redirect=/chat");
    await expect(page.getByLabel(/email/i)).toBeVisible();

    // Submit the test email
    await page.getByLabel(/email/i).fill(MAILBOX);
    await page.getByRole("button", { name: /send|送信|发送/i }).click();

    // Wait for "check email" confirmation
    await expect(page.getByText(/check.*email|メール.*確認|查收/i)).toBeVisible({
      timeout: 10_000,
    });

    // Wait for the email to arrive at mails.dev
    const email = await waitForEmail(beforeSend);

    // Verify email was received
    expect(email.subject).toBeTruthy();
    expect(email.html).toBeTruthy();

    // Verify magic link exists in email
    const magicLink = extractMagicLink(email.html);
    expect(magicLink).toContain("/auth/confirm");
    expect(magicLink).toContain("token_hash=");

    // Verify email locale (should match browser language)
    // Default test browser is English
    expect(verifyEmailLocale(email.html, "en")).toBe(true);
  });

  test("Magic link completes login and redirects to /chat", async ({ page }) => {
    const beforeSend = new Date();

    // Submit magic link from login page
    await page.goto("/login?redirect=/chat");
    await page.getByLabel(/email/i).fill(MAILBOX);
    await page.getByRole("button", { name: /send|送信|发送/i }).click();
    await expect(page.getByText(/check.*email|メール.*確認|查收/i)).toBeVisible({
      timeout: 10_000,
    });

    // Get the magic link from email
    const email = await waitForEmail(beforeSend);
    const magicLink = extractMagicLink(email.html);

    // Visit the magic link — should set cookie and redirect to /chat
    await page.goto(magicLink);
    await page.waitForURL(/\/chat/, { timeout: 15_000 });

    // Should be on /chat now
    expect(page.url()).toContain("/chat");
  });
});
