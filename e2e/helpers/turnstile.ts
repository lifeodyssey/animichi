import type { Page } from "@playwright/test";
import { stubTurnstileSdk } from "./turnstile-sdk";

export { stubTurnstileSdk };

declare global {
  interface Window {
    onAnimichiTurnstile?: (token: string) => void;
  }
}

/** Keep a late SDK load error from racing the test's explicit solved-token callback. */
export async function stubTurnstileEntry(page: Page): Promise<void> {
  await stubTurnstileSdk(page);
  await page.route("**/v1/turnstile/verify", (route) => route.fulfill({ status: 204 }));
}

/** Drive the widget callback; the app still must wait for server verification. */
export async function solveTurnstileEntry(page: Page, token = "e2e-entry-token"): Promise<void> {
  await page.waitForFunction(() => typeof window.onAnimichiTurnstile === "function");
  await page.evaluate((value) => { window.onAnimichiTurnstile?.(value); }, token);
}
