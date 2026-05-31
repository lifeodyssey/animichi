import { test, expect } from "@playwright/test";

test.describe("Public pages — no auth required", () => {
  test("Landing page loads with hero content", async ({ page }) => {
    await page.goto("/");
    // Brand in SharedHeader
    await expect(page.locator("header")).toContainText("聖地巡礼");
  });

  test("Guide page loads with title and spot count", async ({ page }) => {
    await page.goto("/anime/485");
    await expect(page.getByRole("heading", { name: /涼宮ハルヒ/ })).toBeVisible();
    // Spot count in hero section
    await expect(page.locator("text=/\\d+ spots/").first()).toBeVisible();
  });

  test("Guide page shows plan route CTA button", async ({ page }) => {
    await page.goto("/anime/485");
    const cta = page.getByRole("button", { name: /Plan route|ルートを計画|AIで/ });
    await expect(cta).toBeVisible();
  });
});
