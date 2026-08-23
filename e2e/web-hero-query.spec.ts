import { expect, test, type Page } from "@playwright/test";
import { SSE_HEADERS, chatStreamRecording } from "./fixtures/chat-stream";

declare global {
  interface Window {
    onAnimichiTurnstile?: (token: string) => void;
  }
}

/**
 * The former landing hero is gone. These are the same entry-query contracts
 * exercised through their live owner now: `/chat?q=` auto-sends the decoded
 * query and keeps reserved characters inside the query value.
 */
test.use({
  baseURL: process.env.E2E_WEB_BASE_URL ?? "http://localhost:3000",
  locale: "ja-JP",
});

const QUERY = "君の名は。 & #";

async function openChat(page: Page, query?: string): Promise<void> {
  await page.route("https://challenges.cloudflare.com/**", (route) => route.abort());
  await page.route("**/api/auth/get-session", (route) =>
    route.fulfill({ status: 401, json: { error: "no session" } }),
  );
  await page.route("**/healthz", (route) => route.fulfill({ json: { status: "ok" } }));
  const healthy = page.waitForResponse((response) => response.url().includes("/healthz"));
  const path = query === undefined ? "/chat" : `/chat?q=${encodeURIComponent(query)}`;
  await page.goto(path);
  await healthy;
  await expect(page.getByRole("textbox")).toBeVisible();
}

async function solveChallenge(page: Page): Promise<void> {
  await page.waitForFunction(() => typeof window.onAnimichiTurnstile === "function");
  await page.evaluate(() => { window.onAnimichiTurnstile?.("e2e-query-token"); });
}

test("a typed /chat query auto-sends with reserved characters intact", { tag: "@browser" }, async ({ page }) => {
  const bodies: unknown[] = [];
  await page.route("**/v1/chat", (route) => {
    bodies.push(route.request().postDataJSON());
    return route.fulfill({ status: 200, headers: SSE_HEADERS, body: chatStreamRecording("search") });
  });
  await openChat(page, QUERY);
  await solveChallenge(page);

  await expect.poll(() => bodies.length).toBe(1);
  expect(new URL(page.url()).searchParams.get("q")).toBe(QUERY);
  expect(JSON.stringify(bodies[0])).toContain(QUERY);
  await expect(page.getByText("宇治の聖地を2件、徒歩ルートにまとめました。")).toBeVisible();
});

test("a plain /chat entry does not invent an auto-send query", { tag: "@browser" }, async ({ page }) => {
  const bodies: unknown[] = [];
  await page.route("**/v1/chat", (route) => {
    bodies.push(route.request().postDataJSON());
    return route.fulfill({ status: 200, headers: SSE_HEADERS, body: chatStreamRecording("search") });
  });
  await openChat(page);
  expect(bodies).toEqual([]);
  await expect(page.getByText("宇治の聖地を2件、徒歩ルートにまとめました。")).toHaveCount(0);
});
