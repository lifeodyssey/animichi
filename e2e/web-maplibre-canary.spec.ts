import { expect, test, type Page } from "@playwright/test";

test.use({
  baseURL: process.env.E2E_WEB_BASE_URL ?? "http://localhost:3000",
});

const openCanary = async (page: Page, mode: "fallback" | "happy"): Promise<string[]> => {
  const errors: string[] = [];
  page.on("pageerror", (error) => { errors.push(error.message); });
  // `_dev` is a pathless TanStack route segment; the public URL is `/map-canary`.
  await page.goto(`/map-canary?mode=${mode}`);
  return errors;
};

test("MapLibre v5 happy path reaches ready and cleans up on unmount", async ({ page }) => {
  const errors = await openCanary(page, "happy");
  const canary = page.getByTestId("maplibre-canary");
  await expect(canary).toHaveAttribute("data-status", "ready");
  expect(errors).toEqual([]);

  await page.getByRole("button", { name: "Unmount map" }).click();
  await expect(canary).toHaveAttribute("data-status", "unmounted");
  await expect(page.getByTestId("maplibre-canary-container")).toBeEmpty();
});

test("MapLibre v5 setup failures are observable as fallback without a page error", async ({ page }) => {
  const errors = await openCanary(page, "fallback");
  await expect(page.getByTestId("maplibre-canary")).toHaveAttribute("data-status", "fallback");
  expect(errors).toEqual([]);
});
