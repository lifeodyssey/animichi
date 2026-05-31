import { test, expect } from "@playwright/test";

test.describe("Login modal on Landing and Guide pages", () => {
  test("Landing: Login button opens modal", async ({ page }) => {
    await page.goto("/");
    // SharedHeader renders "Log in" as a link (loginHref) or button (onLogin)
    // On Landing it's passed via onOpenAuth to SharedHeader
    const loginBtn = page.locator("header").getByText(/Log in|ログイン|登录/i);
    await loginBtn.click();
    // Should show login modal with email input
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByLabel(/email/i)).toBeVisible();
  });

  test("Landing: ?login=true opens modal on load", async ({ page }) => {
    await page.goto("/?login=true");
    await expect(page.getByRole("dialog")).toBeVisible();
  });

  test("Guide: Plan route CTA opens login modal when not logged in", async ({ page }) => {
    await page.goto("/anime/485");
    // Wait for page to load
    await expect(page.getByRole("heading", { name: /涼宮ハルヒ/ })).toBeVisible();
    // Click CTA
    const cta = page.getByRole("button", { name: /Plan route|ルートを計画/ });
    await cta.click();
    // Login modal should appear
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByLabel(/email/i)).toBeVisible();
    // Should still be on the Guide page (not redirected)
    expect(page.url()).toContain("/anime/485");
  });

  test("Login modal shows magic link hint text", async ({ page }) => {
    await page.goto("/?login=true");
    await expect(page.getByRole("dialog")).toBeVisible();
    // Should show hint about passwordless auth
    await expect(
      page.getByText(/password|パスワード|密码/i).first(),
    ).toBeVisible();
  });

  test("Login modal closes on backdrop click", async ({ page }) => {
    await page.goto("/?login=true");
    await expect(page.getByRole("dialog")).toBeVisible();
    // Click backdrop (outside the dialog card)
    await page.click(".fixed.inset-0", { position: { x: 10, y: 10 } });
    await expect(page.getByRole("dialog")).not.toBeVisible();
  });
});
