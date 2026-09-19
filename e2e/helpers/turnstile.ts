import type { Page } from "@playwright/test";
import { stubTurnstileSdk } from "./turnstile-sdk";

export { stubTurnstileSdk };

/** The callback the app publishes on the page's global object. Named here
 *  rather than reached through `window` because `workers/edge`'s node-hosted
 *  browser lane type-checks without DOM globals — the same reason
 *  `turnstile-sdk.ts` exists — and `window` and `globalThis` are one object in
 *  a document, so the callback is reached exactly as before. */
interface TurnstileHost {
  onAnimichiTurnstile?: (token: string) => void;
}

/** Keep a late SDK load error from racing the test's explicit solved-token callback. */
export async function stubTurnstileEntry(page: Page): Promise<void> {
  await stubTurnstileSdk(page);
  await page.route("**/v1/turnstile/verify", (route) => route.fulfill({ status: 204 }));
}

/** Drive the widget callback; the app still must wait for server verification.
 *
 *  Both calls pass a *function*, never an expression string, and that is a
 *  requirement rather than a style: Playwright evaluates a string argument with
 *  `eval` in the page, which the app's own CSP refuses (`script-src` carries a
 *  nonce and `'strict-dynamic'`, and deliberately no `'unsafe-eval'` — #469), so
 *  the string form fails every browser case with `EvalError: Evaluating a string
 *  as JavaScript violates ...`. A function argument survives the shipped policy,
 *  which is what lets these drivers assert the product's behaviour instead of
 *  exempting themselves from it with `bypassCSP`. */
export async function solveTurnstileEntry(page: Page, token = "e2e-entry-token"): Promise<void> {
  await page.waitForFunction(() => typeof (globalThis as TurnstileHost).onAnimichiTurnstile === "function");
  await page.evaluate((value) => { (globalThis as TurnstileHost).onAnimichiTurnstile?.(value); }, token);
}
