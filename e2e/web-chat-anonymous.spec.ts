import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { chatDictFor } from "../apps/web/src/features/chat/i18n";
import { SSE_HEADERS, chatStreamRecording } from "./fixtures/chat-stream";
import { solveTurnstileEntry, stubTurnstileEntry } from "./helpers/turnstile";

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

/**
 * The real loader is always blocked in this hermetic suite. A shared helper
 * drives the widget callback and stubs only the server verification endpoint;
 * chat still cannot mount until that endpoint answers 2xx.
 */
async function openChat(page: Page): Promise<void> {
  await stubTurnstileEntry(page);
  await page.route("**/healthz", (route) => route.fulfill({ json: { status: "ok" } }));
  const hydrated = page.waitForResponse((response) => response.url().includes("/healthz"));
  await page.goto("/chat");
  await solveTurnstileEntry(page);
  await hydrated;
  await expect(page.getByRole("textbox")).toBeVisible();
}

/**
 * Hand the page a token through the widget's own callback. The transport waits
 * for one before sending an anonymous turn, so with the real loader blocked
 * this is what lets a turn reach the (stubbed) edge at all — and a token the
 * edge then rejects is exactly a spent or expired one.
 */
async function solveChallenge(page: Page, token: string): Promise<void> {
  await solveTurnstileEntry(page, token);
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
      body: JSON.stringify({
        error: {
          code: "anon_budget_exhausted",
          message: "今日はここまで。ログインすると続きから一緒に旅の計画を立てられるよ。",
          action: "login",
        },
      }),
    }),
  );
  await openChat(page);
  await send(page, "ユーフォ");
  // A visitor who never had a session must not be told their session expired.
  await expect(page.getByText(states.d11Message)).toBeVisible();
  await expect(page.getByRole("button", { name: states.d11Login })).toBeVisible();
  await expect(page.getByText(states.d8Message)).toHaveCount(0);
});

test("the anonymous challenge owns the full viewport before chat mounts", async ({ page }) => {
  await stubTurnstileEntry(page);
  await page.goto("/chat");
  const widget = page.locator(".turnstile-entry[data-active='true'] .cf-turnstile");
  await expect(widget).toHaveAttribute("data-sitekey", /^.{24}$/);
  await expect(widget).toHaveAttribute("data-appearance", "interaction-only");
  await expect(page.getByRole("textbox")).toHaveCount(0);
});

test("a rejected entry offers the check retry and never mounts chat", async ({ page }) => {
  await page.route("https://challenges.cloudflare.com/**", (route) => route.abort());
  await page.route("**/v1/turnstile/verify", (route) => route.fulfill({ status: 403 }));
  await page.goto("/chat");
  await solveChallenge(page, "spent-token");
  await expect(page.getByText(ja.turnstile.failed)).toBeVisible();
  await expect(page.getByRole("button", { name: ja.turnstile.retry })).toBeVisible();
  await expect(page.getByRole("textbox")).toHaveCount(0);
});

/**
 * Issue #282 (S1.10) browser AC: exhausting *this* identity's daily message
 * quota withholds sending behind a login CTA without eating the draft, and
 * names the instant the allowance returns rather than guessing at "today".
 * Same inert-gate assumption as the D11 breaker test above.
 */
test("an exhausted daily quota locks sending but keeps the visitor's typed text", async ({ page }) => {
  const resetsAt = new Date(Date.now() + 3_600_000).toISOString();
  await page.route("**/v1/chat", (route) =>
    route.fulfill({
      status: 403,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        error: {
          code: "anon_quota_exhausted",
          message: "今日はここまで・ログインすると続けられるよ。",
          action: "login",
          data: { quota_resets_at: resetsAt },
        },
      }),
    }),
  );
  await openChat(page);
  await send(page, "ユーフォ");

  const notice = page.getByRole("status").filter({ hasText: "メッセージはここまで" });
  await expect(notice).toBeVisible();
  await expect(page.getByRole("button", { name: states.d12Login })).toBeVisible();
  // The reset instant is rendered in the reader's own timezone, not the server's.
  await expect(notice).toContainText(new Intl.DateTimeFormat("ja", { hour: "numeric", minute: "2-digit" }).format(Date.parse(resetsAt)));
  // Not the shared-budget copy and not an expiry — this limit is the visitor's own.
  await expect(page.getByText(states.d11Message)).toHaveCount(0);
  await expect(page.getByText(states.d8Message)).toHaveCount(0);

  const composer = page.getByRole("textbox");
  await composer.fill("宇治にいきたい");
  await expect(composer).toHaveAttribute("placeholder", states.d12InputHint);
  // The accessible name stays the ordinary placeholder; the reason is a description.
  await expect(composer).toHaveAttribute("aria-label", ja.inputPlaceholder);
  await expect(page.getByRole("button", { name: ja.send })).toBeDisabled();
  await composer.press("Enter");
  await expect(composer).toHaveValue("宇治にいきたい");
  // The draft is parked, so the magic-link round-trip cannot lose it.
  const parked = await page.evaluate(() => sessionStorage.getItem("animichi:chat-draft"));
  expect(parked).toBe("宇治にいきたい");
});
