import { expect, type Page } from "@playwright/test";

function pushClientState(next: string): void {
  const current = (window.history.state as Record<string, unknown> | null) ?? {};
  const index = current.__TSR_index;
  const nextIndex = typeof index === "number" ? index + 1 : 1;
  window.history.pushState({ ...current, __TSR_index: nextIndex }, "", next);
}

export async function navigateClient(page: Page, path: string, target: string): Promise<void> {
  const arrived = page.waitForURL((url) => url.pathname === path);
  await page.evaluate(pushClientState, path);
  await arrived;
  await expect(page.locator(target)).toBeVisible();
}
