import { expect, test } from "@playwright/test";

// E2E_WEB_BASE_URL targets the new apps/web app (dev :3000 / CI wrangler :8799); deliberately separate from E2E_BASE_URL in playwright.config.ts, which targets the legacy Next.js frontend on :3001 — both apps coexist until the S0.7 cutover.
test.use({
  baseURL: process.env.E2E_WEB_BASE_URL ?? "http://localhost:3000",
});

test("undefined route renders a branded 404", async ({ page }) => {
  const response = await page.goto("/this-route-does-not-exist");

  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "404" })).toBeVisible();
  await expect(page.getByText("Animichi").first()).toBeVisible();

  const homeLink = page.getByRole("link", { name: "Return home" });
  await expect(homeLink).toBeVisible();
  await expect(homeLink).toHaveAttribute("href", "/");
});
