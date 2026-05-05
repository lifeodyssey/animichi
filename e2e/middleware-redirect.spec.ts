import { test, expect } from "@playwright/test";

test.describe("Middleware auth redirect", () => {
  test("/chat redirects to /login with redirect param", async ({ page }) => {
    await page.goto("/chat");
    await page.waitForURL(/\/login/);
    const url = new URL(page.url());
    expect(url.pathname).toBe("/login");
    expect(url.searchParams.get("redirect")).toBe("/chat");
  });

  test("/settings redirects to /login with redirect param", async ({ page }) => {
    await page.goto("/settings");
    await page.waitForURL(/\/login/);
    const url = new URL(page.url());
    expect(url.pathname).toBe("/login");
    expect(url.searchParams.get("redirect")).toBe("/settings");
  });

  test("/chat?q=test preserves query in redirect", async ({ page }) => {
    await page.goto("/chat?q=test");
    await page.waitForURL(/\/login/);
    const url = new URL(page.url());
    const redirect = url.searchParams.get("redirect");
    expect(redirect).toContain("/chat");
    expect(redirect).toContain("q=test");
  });

  test("Public pages do NOT redirect", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");
    expect(page.url()).not.toContain("/login");

    await page.goto("/anime/485");
    await page.waitForLoadState("domcontentloaded");
    expect(page.url()).not.toContain("/login");
  });
});
