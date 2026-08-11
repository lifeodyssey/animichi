import { expect, test } from "@playwright/test";

/**
 * Live Neon Auth login round-trip (AUTH-2 #950).
 *
 * The rest of the suite stubs the app's transport; this spec is the one that
 * drives the REAL Neon Auth origin end to end. It uses Path A of
 * docs/ops/auth-migration-neon.md §4 — password sign-in via `context.request`,
 * which shares the browser context's cookie jar, so the HttpOnly session
 * cookie lands on the Neon Auth origin exactly as a magic-link verify would.
 * The app then exchanges that cookie for the EdDSA JWT the edge verifies and
 * renders the authenticated App Home.
 *
 * Requires live credentials — without them every test here skips, which is the
 * sanctioned outcome for "flow tests that do not need a live login may run;
 * report skips" (AUTH-2 #950 verify contract). Set:
 *   NEON_AUTH_BASE_URL (or VITE_NEON_AUTH_BASE_URL), QA_NEON_USER_EMAIL, QA_NEON_USER_PASSWORD
 */
const authBaseUrl =
  process.env.NEON_AUTH_BASE_URL ?? process.env.VITE_NEON_AUTH_BASE_URL;
const qaEmail = process.env.QA_NEON_USER_EMAIL;
const qaPassword = process.env.QA_NEON_USER_PASSWORD;
const liveAuthReady = () =>
  authBaseUrl !== undefined && qaEmail !== undefined && qaPassword !== undefined;

test.use({
  baseURL: process.env.E2E_WEB_BASE_URL ?? "http://localhost:3000",
});

test.describe("Neon Auth login", () => {
  test.skip(!liveAuthReady(), "set NEON_AUTH_BASE_URL + QA_NEON_USER_EMAIL + QA_NEON_USER_PASSWORD");

  test("password sign-in reaches the authenticated home and survives a reload", async ({ page, context }) => {
    const response = await context.request.post(`${authBaseUrl}/sign-in/email`, {
      headers: { Origin: "http://localhost:3000" },
      data: { email: qaEmail, password: qaPassword },
    });
    expect(response.ok()).toBeTruthy();

    // The callback redeems the session cookie for the app's cached JWT, then
    // navigates home. Landing on "/" (rather than the marketing page) is the
    // signal that the exchange worked — the root route renders AppHome only
    // when `useAuthStatus()` resolves authenticated.
    await page.goto("/auth/callback");
    await page.waitForURL((url) => url.pathname === "/");
    await expect(page.getByRole("searchbox")).toBeVisible();

    // AUTH-2 #950: the browser session cookie/JWT must survive page reloads.
    await page.reload();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("searchbox")).toBeVisible();
  });

  test("an unauthenticated visit keeps the marketing landing", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("searchbox")).toHaveCount(0);
  });
});
