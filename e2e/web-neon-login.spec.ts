import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * Live Neon Auth login round-trip (AUTH-2 #950). The retired landing is not a
 * destination anymore, so the authenticated contract is verified on `/chat`:
 * the callback returns there and the composer survives a reload.
 *
 * Requires live credentials; without them these tests skip by design. Set
 * NEON_AUTH_BASE_URL (or VITE_NEON_AUTH_BASE_URL), QA_NEON_USER_EMAIL, and
 * QA_NEON_USER_PASSWORD.
 */
const authBaseUrl = process.env.NEON_AUTH_BASE_URL ?? process.env.VITE_NEON_AUTH_BASE_URL;
const qaEmail = process.env.QA_NEON_USER_EMAIL;
const qaPassword = process.env.QA_NEON_USER_PASSWORD;
const appBaseUrl = process.env.E2E_WEB_BASE_URL ?? "http://localhost:3000";
const liveAuthReady = () => authBaseUrl !== undefined && qaEmail !== undefined && qaPassword !== undefined;

test.use({
  baseURL: appBaseUrl,
});

async function openAnonymousChat(page: Page): Promise<void> {
  await page.route("https://challenges.cloudflare.com/**", (route) => route.abort());
  await page.route("**/api/auth/get-session", (route) =>
    route.fulfill({ status: 401, json: { error: "no session" } }),
  );
  await page.route("**/healthz", (route) => route.fulfill({ json: { status: "ok" } }));
  const healthy = page.waitForResponse((response) => response.url().includes("/healthz"));
  await page.goto("/chat");
  await healthy;
  await expect(page.getByRole("textbox")).toBeVisible();
}

test.describe("Neon Auth login", () => {
  test("password sign-in returns to Chat and survives a reload", async ({ page, context }) => {
    test.skip(!liveAuthReady(), "set NEON_AUTH_BASE_URL + QA_NEON_USER_EMAIL + QA_NEON_USER_PASSWORD");
    const response = await context.request.post(`${authBaseUrl}/sign-in/email`, {
      headers: { Origin: new URL(appBaseUrl).origin },
      data: { email: qaEmail, password: qaPassword },
    });
    expect(response.ok()).toBeTruthy();

    await page.goto("/auth/callback?next=%2Fchat");
    await page.waitForURL((url) => url.pathname === "/chat");
    await expect(page.getByRole("textbox")).toBeVisible();
    await expect(page.getByRole("button", { name: /ログイン|sign in|log in/i })).toHaveCount(0);

    await page.reload();
    await expect(page).toHaveURL(/\/chat(?:\?|$)/);
    await expect(page.getByRole("textbox")).toBeVisible();
  });

  test("an unauthenticated visit opens the anonymous Chat entry", async ({ page }) => {
    await openAnonymousChat(page);
    await expect(page).toHaveURL(/\/chat(?:\?|$)/);
    await expect(page.getByRole("button", { name: /ログイン|sign in|log in/i })).toBeVisible();
    await expect(page.getByRole("searchbox")).toHaveCount(0);
  });
});
