import type { Page } from "@playwright/test";

declare global {
  interface Window {
    onAnimichiTurnstile?: (token: string) => void;
  }
}

/** Keep browser tests hermetic while exercising the real entry handshake. */
export async function stubTurnstileEntry(page: Page): Promise<void> {
  await page.route("https://challenges.cloudflare.com/**", (route) => route.abort());
  await page.route("**/v1/turnstile/verify", (route) => route.fulfill({ status: 204 }));
}

/** Drive the widget callback; the app still must wait for server verification. */
export async function solveTurnstileEntry(page: Page, token = "e2e-entry-token"): Promise<void> {
  await page.waitForFunction(() => typeof window.onAnimichiTurnstile === "function");
  await page.evaluate((value) => { window.onAnimichiTurnstile?.(value); }, token);
}
