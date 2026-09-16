import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { solveTurnstileEntry, stubTurnstileEntry } from "./helpers/turnstile";
import { declaredNeonAuthOrigin } from "./helpers/neon-auth-origin";

/**
 * Live Neon Auth login round-trip (AUTH-2 #950). The retired landing is not a
 * destination anymore, so the authenticated contract is verified on `/chat`:
 * the callback returns there and the composer survives a reload.
 *
 * REQUIRED, never optional (#1690). This is the only end-to-end proof of the
 * login chain, and a self-skipping spec is indistinguishable from a passing one
 * in a summary, so this file has no skip path left: without credentials the
 * case FAILS, naming exactly what is missing. Emitting them is the lane's job —
 * `pnpm --filter animichi-e2e run test:login` reads them from `.env.test`
 * (docs/ops/auth-migration-neon.md §4 Path A). No pull-request job may hold a
 * credential (`.github/test/workflow-credentials.test.rb`), so PR CI reports this
 * proof as `NOT RUN` rather than selecting it; nothing here decides that.
 */
// The one resolution rule, shared with `playwright.config.ts` (#1701 review).
// A `??` fallback here disagreed with the config exactly when the primary
// variable was declared but empty: the app under test was pointed at the
// `VITE_` origin while this proof took the empty string, so it failed before
// login for a reason that had nothing to do with login.
const authBaseUrl = declaredNeonAuthOrigin(process.env);
const qaEmail = process.env.QA_NEON_USER_EMAIL;
const qaPassword = process.env.QA_NEON_USER_PASSWORD;
const appBaseUrl = process.env.E2E_WEB_BASE_URL ?? "http://localhost:3000";
// `process.env` can hold "", so a defined-but-empty value is unavailable too.
const isPresent = (value: string | undefined): value is string =>
  value !== undefined && value.trim() !== "";

interface LiveAuthCredentials {
  baseUrl: string;
  email: string;
  password: string;
}

/** The variables the live lane needs, in the order its message names them. */
function missingLiveAuthVars(): readonly string[] {
  const declared: readonly (readonly [string, string | undefined])[] = [
    ["NEON_AUTH_BASE_URL (or VITE_NEON_AUTH_BASE_URL)", authBaseUrl],
    ["QA_NEON_USER_EMAIL", qaEmail],
    ["QA_NEON_USER_PASSWORD", qaPassword],
  ];
  return declared.filter(([, value]) => !isPresent(value)).map(([name]) => name);
}

/**
 * Fail closed (#1690). The alternative — `test.skip(!ready)` — reported this
 * proof as a pass in every CI run while asserting nothing, which is how the
 * defect stayed hidden. The message is the lane's repair instruction, so it
 * names the variables rather than the symptom.
 */
function requireLiveAuth(): LiveAuthCredentials {
  const missing = missingLiveAuthVars();
  // Inline (not via `missing`) so the predicates narrow the consts.
  if (!isPresent(authBaseUrl) || !isPresent(qaEmail) || !isPresent(qaPassword)) {
    throw new Error(
      `the live Neon Auth login proof CANNOT RUN: ${missing.join(", ")} ` +
        `${missing.length === 1 ? "is" : "are"} unset or empty. This lane is not ` +
        "optional — unprovisioned credentials must fail it, never skip past it (#1690).",
    );
  }
  return { baseUrl: authBaseUrl, email: qaEmail, password: qaPassword };
}

test.use({
  baseURL: appBaseUrl,
});

async function openAnonymousChat(page: Page): Promise<void> {
  await stubTurnstileEntry(page);
  await page.route("**/api/auth/get-session", (route) =>
    route.fulfill({ status: 401, json: { error: "no session" } }),
  );
  await page.route("**/healthz", (route) => route.fulfill({ json: { status: "ok" } }));
  const healthy = page.waitForResponse((response) => response.url().includes("/healthz"));
  await page.goto("/chat");
  await solveTurnstileEntry(page);
  await healthy;
  await expect(page.getByRole("textbox")).toBeVisible();
}

test.describe("Neon Auth login", () => {
  test("password sign-in returns to Chat and survives a reload", async ({ page, context }) => {
    const credentials = requireLiveAuth();
    const response = await context.request.post(`${credentials.baseUrl}/sign-in/email`, {
      headers: { Origin: new URL(appBaseUrl).origin },
      data: { email: credentials.email, password: credentials.password },
    });
    expect(response.ok()).toBeTruthy();

    // The Neon Auth leg above and the callback's SDK redeem below are LIVE; the
    // anonymous-session claim is not part of this proof and points at the agent
    // origin, which this lane does not run. Stub it the way every other
    // transport in this suite is stubbed, or the callback correctly parks on
    // its adoption-failure screen and never reaches `/chat`.
    await page.route("**/v1/sessions/adopt", (route) =>
      route.fulfill({ status: 200, json: { adopted: 0 } }),
    );

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
