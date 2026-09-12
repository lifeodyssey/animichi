import type { Page } from "@playwright/test";

/** Node-hosted browser tests can stub SDK loading without importing DOM globals. */
export async function stubTurnstileSdk(page: Page): Promise<void> {
  await page.route("https://challenges.cloudflare.com/**", (route) => route.fulfill({
    contentType: "application/javascript",
    body: "window.turnstile = { render: () => 'e2e-widget', reset: () => {}, remove: () => {} };",
  }));
}
