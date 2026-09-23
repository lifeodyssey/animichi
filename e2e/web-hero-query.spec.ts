import { expect, test, type Page } from "@playwright/test";
import { SSE_HEADERS, chatStreamRecording, patchSessionId } from "./fixtures/chat-stream";
import { solveTurnstileEntry, stubTurnstileEntry } from "./helpers/turnstile";

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
const SESSION_ID = "s-1512";

async function openChat(page: Page, query?: string): Promise<void> {
  await stubTurnstileEntry(page);
  await page.route("**/api/auth/get-session", (route) =>
    route.fulfill({ status: 401, json: { error: "no session" } }),
  );
  await page.route("**/healthz", (route) => route.fulfill({ json: { status: "ok" } }));
  const path = query === undefined ? "/chat" : `/chat?q=${encodeURIComponent(query)}`;
  await page.goto(path);
}

async function solveChallenge(page: Page): Promise<void> {
  await solveTurnstileEntry(page, "e2e-query-token");
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
  await solveChallenge(page);
  await expect(page.getByRole("textbox")).toBeVisible();
  expect(bodies).toEqual([]);
  await expect(page.getByText("宇治の聖地を2件、徒歩ルートにまとめました。")).toHaveCount(0);
});

/**
 * #1512 AC2. `useAutoSend`'s guard is a ref, so a remount gets a fresh one and
 * cannot itself be what stops a second send. What stops it is the address bar:
 * the id the backend assigns is published into `?session=` (`#1337`), and the
 * auto-send is gated on that being absent. Back then Forward restores the
 * REPLACED entry, so the returning page reads a session and never re-sends.
 *
 * The stub therefore has to assign an id, as the deployed agent always does
 * (`workers/edge/src/agent/views/public-content.ts` takes `sessionId: string`);
 * the raw recordings captured a null one, and a test built on that would be
 * measuring the fixture rather than the page.
 *
 * `replays` is the witness that the Forward leg really re-entered the page: a
 * page restored whole from the back/forward cache would keep the ref, pass this
 * for a reason that has nothing to do with the gate, and survive its mutation.
 */
test("Back then Forward to /chat?q= does not re-send the hero query", { tag: "@browser" }, async ({ page }) => {
  const bodies: unknown[] = [];
  const replays: string[] = [];
  await page.route("**/v1/chat", (route) => {
    bodies.push(route.request().postDataJSON());
    return route.fulfill({ status: 200, headers: SSE_HEADERS, body: patchSessionId(chatStreamRecording("search"), SESSION_ID) });
  });
  await page.route(`**/v1/conversations/${SESSION_ID}/messages`, (route) => {
    replays.push(route.request().url());
    return route.fulfill({ json: { messages: [], revision: 1, next_offset: null } });
  });

  await page.goto("/");
  await openChat(page, QUERY);
  await solveChallenge(page);
  await expect.poll(() => bodies.length).toBe(1);
  await expect(page).toHaveURL(new RegExp(`[?&]session=${SESSION_ID}(&|$)`, "u"));
  expect(replays).toEqual([]);

  await page.goBack();
  await page.goForward();
  await expect(page).toHaveURL(new RegExp(`[?&]session=${SESSION_ID}(&|$)`, "u"));
  await solveChallenge(page);
  await expect.poll(() => replays.length).toBe(1);
  expect(bodies).toHaveLength(1);
});
