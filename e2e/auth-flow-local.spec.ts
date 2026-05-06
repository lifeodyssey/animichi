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
test.describe.serial("Auth flow — email-based login", () => {
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

  test("Email content matches browser locale — English", async ({ browser }) => {
    const ctx = await browser.newContext({ locale: "en-US" });
    const page = await ctx.newPage();
    const testEmail = getTestEmail();
    const beforeSend = new Date();

    await page.goto("/login?redirect=/chat");
    await page.getByLabel(/email/i).fill(testEmail);
    await page.getByRole("button", { name: /send/i }).click();
    await expect(page.getByText(/check.*email/i)).toBeVisible({ timeout: 10_000 });

    const email = await waitForEmail(testEmail, beforeSend);
    expect(email.subject).toContain("Seichijunrei");
    expect(email.html).toContain("Log in");
    expect(email.html).toContain("seichijunrei");
    await ctx.close();
  });

  test("Email content matches browser locale — Japanese", async ({ browser }) => {
    const ctx = await browser.newContext({ locale: "ja-JP" });
    const page = await ctx.newPage();
    const testEmail = getTestEmail();
    const beforeSend = new Date();

    await page.goto("/login?redirect=/chat");
    await page.getByLabel(/メールアドレス|email/i).fill(testEmail);
    await page.getByRole("button", { name: /送信|send/i }).click();
    await expect(page.getByText(/メール.*確認|check.*email/i)).toBeVisible({ timeout: 10_000 });

    const email = await waitForEmail(testEmail, beforeSend);
    expect(email.subject).toContain("ログイン");
    expect(email.html).toContain("ログインする");
    expect(email.html).toContain("聖地巡礼");
    await ctx.close();
  });

  test("Email content matches browser locale — Chinese", async ({ browser }) => {
    const ctx = await browser.newContext({ locale: "zh-CN" });
    const page = await ctx.newPage();
    const testEmail = getTestEmail();
    const beforeSend = new Date();

    await page.goto("/login?redirect=/chat");
    await page.getByLabel(/邮箱|email/i).fill(testEmail);
    await page.getByRole("button", { name: /发送|send/i }).click();
    await expect(page.getByText(/查收|check.*email/i)).toBeVisible({ timeout: 10_000 });

    const email = await waitForEmail(testEmail, beforeSend);
    expect(email.subject).toContain("登录");
    expect(email.html).toContain("点击登录");
    expect(email.html).toContain("聖地巡礼");
    await ctx.close();
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
