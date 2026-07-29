import { expect, test } from "@playwright/test";
import type { BrowserContext, Page } from "@playwright/test";
import { chatDictFor } from "../apps/web/src/features/chat/i18n";
import { DEFERRED_SAVE_KEY } from "../apps/web/src/features/chat/save/deferredSave";
import { SSE_HEADERS, chatStreamRecording, patchFinalFrame } from "./fixtures/chat-stream";

/**
 * Issue #273 (S1.7) Task 2 browser ACs: the 「保存する」 CTA is the only proactive
 * opener of the login wall, and the deferred save intent survives the magic-link
 * navigation.
 *
 * The lifecycle test deliberately uses a **second page in the same browser
 * context** — a new tab of the same profile, sharing origin storage. A fresh
 * Playwright `BrowserContext` would isolate `localStorage` and fail a correct
 * implementation; a same-tab jsdom simulation would pass even for the broken,
 * tab-scoped `sessionStorage` design this replaced.
 *
 * Prerequisite: `VITE_NEON_AUTH_BASE_URL` must be set for the app under test, or
 * the auth callback cannot redeem a session and the replay never runs.
 */
test.use({
  baseURL: process.env.E2E_WEB_BASE_URL ?? "http://localhost:3000",
  locale: "ja-JP",
});

const ja = chatDictFor("ja");

/** The recording carries a route but no timed itinerary; the CTA row lives on
 * the itinerary, so inject the stops the S1.5 card renders. */
function routeStream(): string {
  return patchFinalFrame(chatStreamRecording("search"), (envelope) => {
    const data = envelope.data as { route: Record<string, unknown> };
    data.route.timed_itinerary = {
      stops: [
        { cluster_id: "p1", name: "宇治橋", arrive: "10:00", depart: "10:20", dwell_minutes: 20, lat: 34.891, lng: 135.807, photo_count: 4 },
        { cluster_id: "p2", name: "京阪宇治駅", arrive: "10:32", depart: "10:52", dwell_minutes: 20, lat: 34.911, lng: 135.806, photo_count: 9 },
      ],
      legs: [{ from_id: "p1", to_id: "p2", mode: "walk", duration_minutes: 12, distance_m: 740 }],
      total_minutes: 60,
      total_distance_m: 740,
      pacing: "chill",
      start_time: "10:00",
      export_google_maps_url: [],
    };
    return envelope;
  });
}

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

/** Record every users.saveRoute body the app sends, answering with a saved row. */
async function captureSaves(context: BrowserContext, bodies: unknown[]): Promise<void> {
  await context.route("**/v1/users/routes", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    bodies.push(route.request().postDataJSON());
    return route.fulfill({
      json: {
        id: "11111111-1111-4111-8111-111111111111",
        title: "saved",
        point_ids: ["p1", "p2"],
        status: "saved",
        saved_at: "2026-07-28T00:00:00.000Z",
        updated_at: "2026-07-28T00:00:00.000Z",
      },
    });
  });
}

async function stubAuthToken(context: BrowserContext): Promise<void> {
  await context.route("**/token", (route) => route.fulfill({ json: { token: "e2e-token" } }));
}

async function planRoute(page: Page): Promise<void> {
  await page.route("**/v1/chat", (route) =>
    route.fulfill({ status: 200, headers: SSE_HEADERS, body: routeStream() }),
  );
  await openChat(page);
  await send(page, "ユーフォのルートを組んで");
  await expect(page.getByRole("list", { name: ja.route.timelineLabel })).toBeVisible();
}

test("no happy-path step opens the login dialog before the 保存する tap", async ({ page }) => {
  await page.route("**/v1/chat", (route) =>
    route.fulfill({ status: 200, headers: SSE_HEADERS, body: chatStreamRecording("clarify") }),
  );
  await openChat(page);
  await send(page, "ユーフォ");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await page.unroute("**/v1/chat");
  await page.route("**/v1/chat", (route) =>
    route.fulfill({ status: 200, headers: SSE_HEADERS, body: routeStream() }),
  );
  await send(page, "響け!ユーフォニアム");
  await expect(page.getByRole("list", { name: ja.route.timelineLabel })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await send(page, "もう少しゆっくりにして");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("an anonymous 保存する tap opens the magic-link login dialog", async ({ page }) => {
  await planRoute(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: ja.route.saveCta }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
});

/** The mainline: send the link, then close the modal to go read the email. */
async function sendLinkAndDismiss(page: Page): Promise<void> {
  await page.route("**/send-magic-link*", (route) => route.fulfill({ json: { status: true } }));
  await page.getByRole("textbox", { name: /メール|email/i }).fill("fan@example.com");
  await page.getByRole("button", { name: /ログインリンク|Send/i }).click();
  await expect(page.getByRole("status")).toBeVisible();
  await page.getByRole("button", { name: /閉じる|Close/i }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

test("closing the wall after the link is sent keeps the intent — the mainline", async ({ page, context }) => {
  const bodies: unknown[] = [];
  await captureSaves(context, bodies);
  await stubAuthToken(context);
  await planRoute(page);
  await page.getByRole("button", { name: ja.route.saveCta }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await sendLinkAndDismiss(page);

  // Going to read the email is not a cancellation: the intent must still be here.
  const stashed = await page.evaluate((key) => localStorage.getItem(key), DEFERRED_SAVE_KEY);
  expect(stashed).toContain("p1");

  const callbackTab = await context.newPage();
  await callbackTab.goto("/auth/callback");
  await expect.poll(() => bodies.length).toBe(1);
});

test("closing the wall before sending anything cancels the save", async ({ page, context }) => {
  const bodies: unknown[] = [];
  await captureSaves(context, bodies);
  await stubAuthToken(context);
  await planRoute(page);
  await page.getByRole("button", { name: ja.route.saveCta }).click();
  await page.getByRole("button", { name: /閉じる|Close/i }).click();
  expect(await page.evaluate((key) => localStorage.getItem(key), DEFERRED_SAVE_KEY)).toBeNull();

  const callbackTab = await context.newPage();
  await callbackTab.goto("/auth/callback");
  await callbackTab.waitForURL((url) => url.pathname === "/");
  expect(bodies).toEqual([]);
});

test("the deferred intent survives a new tab of the same profile and replays once", async ({ page, context }) => {
  const bodies: unknown[] = [];
  await captureSaves(context, bodies);
  await stubAuthToken(context);
  await planRoute(page);
  await page.getByRole("button", { name: ja.route.saveCta }).click();
  await expect(page.getByRole("dialog")).toBeVisible();

  // Origin-scoped, not tab-scoped: sessionStorage would be empty in the new tab.
  expect(await page.evaluate((key) => sessionStorage.getItem(key), DEFERRED_SAVE_KEY)).toBeNull();

  const callbackTab = await context.newPage();
  await callbackTab.goto("/auth/callback");
  const stashed = await callbackTab.evaluate((key) => localStorage.getItem(key), DEFERRED_SAVE_KEY);
  expect(stashed).toContain("p1");

  await expect.poll(() => bodies.length).toBe(1);
  expect((bodies[0] as { point_ids: string[] }).point_ids).toEqual(["p1", "p2"]);
  await expect
    .poll(() => callbackTab.evaluate((key) => localStorage.getItem(key), DEFERRED_SAVE_KEY))
    .toBeNull();
});

test("a login the save CTA never started replays nothing", async ({ page, context }) => {
  const bodies: unknown[] = [];
  await captureSaves(context, bodies);
  await stubAuthToken(context);
  await page.goto("/auth/callback");
  // Deterministic signal: the callback navigates home only once the redeem —
  // and therefore the replay decision — has completed. No arbitrary wait.
  await page.waitForURL((url) => url.pathname === "/");
  expect(bodies).toEqual([]);
});
