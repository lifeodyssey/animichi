import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { chatDictFor } from "../apps/web/src/features/chat/i18n";
import { SSE_HEADERS, chatStreamRecording } from "./fixtures/chat-stream";

declare global {
  interface Window {
    onAnimichiTurnstile?: (token: string) => void;
  }
}

/**
 * Issue #274 (S1.8) browser ACs: the whole chat round-trip is reachable without
 * a session, and the edge rate limit surfaces as in-character copy rather than
 * a bare 429. The page carries no Supabase session in these runs — the requests
 * simply omit Authorization, which is exactly what an anonymous visitor sends.
 */
test.use({
  baseURL: process.env.E2E_WEB_BASE_URL ?? "http://localhost:3000",
  locale: "ja-JP",
});

const ja = chatDictFor("ja");
const states = ja.errorStates;

async function openChat(page: Page): Promise<void> {
  await page.route("**/healthz", (route) => route.fulfill({ json: { status: "ok" } }));
  const hydrated = page.waitForResponse((response) => response.url().includes("/healthz"));
  await page.goto("/chat");
  await hydrated;
}

async function send(page: Page, text: string): Promise<void> {
  await page.getByRole("textbox").fill(text);
  await page.getByRole("button", { name: ja.send }).click();
}

test("an anonymous visitor completes a full chat round-trip with no login prompt", async ({ page }) => {
  const authorizations: (string | null)[] = [];
  await page.route("**/v1/chat", (route) => {
    authorizations.push(route.request().headers().authorization ?? null);
    return route.fulfill({ status: 200, headers: SSE_HEADERS, body: chatStreamRecording("search") });
  });
  await openChat(page);
  await send(page, "ユーフォ");
  await expect(page.getByText("宇治の聖地を2件、徒歩ルートにまとめました。")).toBeVisible();
  await expect(page.getByText("宇治橋")).toBeVisible();
  expect(authorizations).toEqual([null]);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: states.d8Login })).toHaveCount(0);
});

test("a rate-limited anonymous turn shows the wait copy, not a bare 429", async ({ page }) => {
  await page.route("**/v1/chat", (route) =>
    route.fulfill({
      status: 429,
      headers: { "content-type": "application/json", "retry-after": "60" },
      body: JSON.stringify({ error: { code: "rate_limited", message: "少し待ってね" } }),
    }),
  );
  await openChat(page);
  await send(page, "ユーフォ");
  await expect(page.getByText(states.d10Message)).toBeVisible();
  await expect(page.getByRole("button", { name: states.d10Retry })).toBeVisible();
  await expect(page.getByText(/429/)).toHaveCount(0);
  await expect(page.getByText("ユーフォ")).toBeVisible();
});

test("the anonymous budget breaker guides the visitor to login instead of failing silently", async ({ page }) => {
  await page.route("**/v1/chat", (route) =>
    route.fulfill({
      status: 403,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ error: { code: "anon_budget_exhausted", action: "login" } }),
    }),
  );
  await openChat(page);
  await send(page, "ユーフォ");
  // A visitor who never had a session must not be told their session expired.
  await expect(page.getByText(states.d11Message)).toBeVisible();
  await expect(page.getByRole("button", { name: states.d11Login })).toBeVisible();
  await expect(page.getByText(states.d8Message)).toHaveCount(0);
});

/**
 * Issue #447: the edge Turnstile gate is armed on the anonymous branch, so the
 * anonymous entry must both carry the widget and handle the edge's retryable
 * rejection. `api.js` is blocked here — the widget's contract with the page is
 * the `cf-turnstile` element and its data-attributes, not Cloudflare's iframe.
 */
async function blockTurnstileLoader(page: Page): Promise<void> {
  await page.route("https://challenges.cloudflare.com/**", (route) => route.abort());
}

/**
 * Hand the page a token through the widget's own callback. The transport waits
 * for one before sending an anonymous turn, so with the real loader blocked
 * this is what lets a turn reach the (stubbed) edge at all — and a token the
 * edge then rejects is exactly a spent or expired one.
 */
async function solveChallenge(page: Page, token: string): Promise<void> {
  await page.waitForFunction(() => typeof window.onAnimichiTurnstile === "function");
  await page.evaluate((value) => { window.onAnimichiTurnstile?.(value); }, token);
}

test("the anonymous entry carries the challenge widget in the dock, not in the thread", async ({ page }) => {
  await blockTurnstileLoader(page);
  await openChat(page);
  const widget = page.locator(".turnstile-gate .cf-turnstile");
  await expect(widget).toHaveAttribute("data-sitekey", /^.{24}$/);
  await expect(widget).toHaveAttribute("data-appearance", "interaction-only");
  await expect(page.locator(".chat-input + .turnstile-gate")).toHaveCount(1);
});

test("a challenged anonymous turn offers the check retry, never a login prompt", async ({ page }) => {
  await blockTurnstileLoader(page);
  await page.route("**/v1/chat", (route) =>
    route.fulfill({
      status: 403,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        error: { code: "turnstile_required", message: "Turnstile verification required.", retryable: true },
      }),
    }),
  );
  await openChat(page);
  await solveChallenge(page, "spent-token");
  await send(page, "ユーフォ");
  await expect(page.getByText(ja.turnstile.failed)).toBeVisible();
  await expect(page.getByRole("button", { name: ja.turnstile.retry })).toBeVisible();
  await expect(page.getByText(states.d8Message)).toHaveCount(0);
  await expect(page.getByRole("button", { name: states.d8Login })).toHaveCount(0);
});
