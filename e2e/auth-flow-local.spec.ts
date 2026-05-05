import { test, expect } from "@playwright/test";
import { waitForEmail, extractMagicLink, verifyEmailLocale, getTestEmail } from "./fixtures/email";

/**
 * Auth flow E2E tests.
 *
 * Local: supabase start → Mailpit captures emails
 * CI:    E2E_EMAIL_PROVIDER=mails → mails.dev captures emails
 *
 * Both environments use the same test code.
 */
test.describe("Auth flow — email-based login", () => {
  test.slow();

  test("Login page: submit email → magic link arrives → verify content", async ({ page }) => {
    const testEmail = getTestEmail();
    const beforeSend = new Date();

    await page.goto("/login?redirect=/chat");
    await expect(page.getByLabel(/email/i)).toBeVisible();

    await page.getByLabel(/email/i).fill(testEmail);
    await page.getByRole("button", { name: /send|送信|发送/i }).click();

    await expect(
      page.getByText(/check.*email|メール.*確認|查收/i),
    ).toBeVisible({ timeout: 10_000 });

    // Wait for email
    const email = await waitForEmail(testEmail, beforeSend);
    expect(email.subject).toBeTruthy();
    expect(email.html).toBeTruthy();

    // Verify magic link exists
    const magicLink = extractMagicLink(email.html);
    expect(magicLink).toBeTruthy();
  });

  test("Magic link completes login → redirects to /chat", async ({ page }) => {
    const testEmail = getTestEmail();
    const beforeSend = new Date();

    await page.goto("/login?redirect=/chat");
    await page.getByLabel(/email/i).fill(testEmail);
    await page.getByRole("button", { name: /send|送信|发送/i }).click();
    await expect(
      page.getByText(/check.*email|メール.*確認|查収/i),
    ).toBeVisible({ timeout: 10_000 });

    const email = await waitForEmail(testEmail, beforeSend);
    const magicLink = extractMagicLink(email.html);

    // Visit magic link → should set cookie and redirect to /chat
    await page.goto(magicLink);
    await page.waitForURL(/\/chat/, { timeout: 15_000 });
    expect(page.url()).toContain("/chat");
  });

  test("Guide CTA → login modal → email → redirect to /chat with query", async ({ page }) => {
    const testEmail = getTestEmail();
    const beforeSend = new Date();

    await page.goto("/anime/11291");
    await expect(page.getByRole("heading", { name: /涼宮ハルヒ/ })).toBeVisible();

    // Click CTA → login modal
    await page.getByRole("button", { name: /Plan route|ルートを計画|AIで/ }).click();
    await expect(page.getByRole("dialog")).toBeVisible();

    // Submit email
    await page.getByLabel(/email/i).fill(testEmail);
    await page.getByRole("button", { name: /send|送信|発送/i }).click();

    const email = await waitForEmail(testEmail, beforeSend);
    const magicLink = extractMagicLink(email.html);

    await page.goto(magicLink);
    await page.waitForURL(/\/chat/, { timeout: 15_000 });
    expect(page.url()).toContain("/chat");
  });
});
