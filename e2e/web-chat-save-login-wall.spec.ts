import { expect, test } from "@playwright/test";
import type { BrowserContext, Page } from "@playwright/test";
import { chatDictFor } from "../apps/web/src/features/chat/i18n";
import { dictFor } from "../apps/web/src/i18n/dictionaries";
import { DEFERRED_SAVE_KEY, DEFERRED_SAVE_TTL_MS } from "../apps/web/src/features/chat/save/deferred-save";
import { SSE_HEADERS, chatStreamRecording, patchFinalFrame } from "./fixtures/chat-stream";
import { solveTurnstileEntry, stubTurnstileEntry } from "./helpers/turnstile";

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
const authJa = dictFor("ja").auth;

/** The recording carries a route but no timed itinerary; the CTA row lives on
 * the itinerary, so inject the stops the S1.5 card renders. */
function routeStream(): string {
  return patchFinalFrame(chatStreamRecording("search"), (envelope) => {
    const data = envelope.data as { itinerary: Record<string, unknown> };
    data.itinerary.timed_itinerary = {
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
  await stubTurnstileEntry(page);
  await stubAnonymousSession(page);
  await page.route("**/healthz", (route) => route.fulfill({ json: { status: "ok" } }));
  const hydrated = page.waitForResponse((response) => response.url().includes("/healthz"));
  await page.goto("/chat");
  await solveTurnstileEntry(page);
  await hydrated;
}

async function send(page: Page, text: string): Promise<void> {
  await page.getByRole("textbox").fill(text);
  await page.getByRole("button", { name: ja.send }).click();
}

/** C2t (issue #260 AC2): a route turn stating neither a departure point nor a
 * time waits behind the 「おまかせ」 chip, which sends it unchanged. */
async function sendRoute(page: Page, text: string): Promise<void> {
  await send(page, text);
  await page.getByRole("button", { name: ja.departure.autoChip }).click();
}

/** Record every users.saveSavedRoute body the app sends, answering with a saved row. */
async function captureSaves(context: BrowserContext, bodies: unknown[]): Promise<void> {
  await context.route("**/v1/users/saved-routes", async (route) => {
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

/** The suite's anonymous answer on the SDK session probe, same 401 as
 * `web-hero-query.spec.ts`: "anonymous", or the 保存する tap would skip the wall. */
async function stubAnonymousSession(page: Page): Promise<void> {
  await page.route("**/api/auth/get-session", (route) =>
    route.fulfill({ status: 401, json: { error: "no session" } }),
  );
}

/** The JWT the callback redeems. Three segments, because `neon-auth-client.ts`
 * `jwtFromSession` rejects anything else, and an `exp` far ahead to stay cached. */
const E2E_SESSION_JWT = "eyJhbGciOiJFZERTQSJ9.eyJleHAiOjQxMDI0NDQ4MDB9.c2ln";

/** The callback tab is the one signed-in page: `getSession()` answers with the
 * magic-link session, and the SDK injects the JWT off `set-auth-jwt`. */
async function stubSignedInSession(page: Page): Promise<void> {
  await page.route("**/api/auth/get-session", (route) =>
    route.fulfill({
      headers: { "set-auth-jwt": E2E_SESSION_JWT },
      json: { session: { token: E2E_SESSION_JWT }, user: { id: "e2e-user", email: "fan@example.com" } },
    }),
  );
}

/** A signed-in callback tab: adoption no-ops, so the deferred save drives it. */
async function openCallbackTab(context: BrowserContext): Promise<Page> {
  const tab = await context.newPage();
  await stubSignedInSession(tab);
  await stubSessionAdopt(tab);
  return tab;
}

/** The callback also adopts the browser's anonymous sessions. This lane holds no edge: the endpoint is
 * doubled here, so this spec cannot fail when the native adoption breaks (#1601 AC5). The live browser
 * assertion is workers/edge/host-integration-test/session-adoption.browser.ts (native browser lane). */
async function stubSessionAdopt(page: Page): Promise<void> {
  await page.route("**/v1/sessions/adopt", (route) => route.fulfill({ json: { adopted: 0, noop_class: "no_rows" } }));
}

/** The first save POST 5xxes, the retry succeeds — for the browser-seam retry AC. */
async function captureSaveWithRetry(context: BrowserContext, bodies: unknown[]): Promise<void> {
  let posts = 0;
  await context.route("**/v1/users/saved-routes", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    bodies.push(route.request().postDataJSON());
    posts += 1;
    if (posts === 1) return route.fulfill({ status: 503, json: {} });
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

/** Plant an intent directly in the profile's origin storage, bypassing the wall. */
async function stashIntent(page: Page, createdAt: number): Promise<void> {
  await page.goto("/");
  await page.evaluate(
    ({ key, intent }) => { localStorage.setItem(key, JSON.stringify(intent)); },
    { key: DEFERRED_SAVE_KEY, intent: { pointIds: ["p1", "p2"], title: "宇治・2スポット", createdAt } },
  );
}

async function planRoute(page: Page): Promise<void> {
  await page.route("**/v1/chat", (route) =>
    route.fulfill({ status: 200, headers: SSE_HEADERS, body: routeStream() }),
  );
  await openChat(page);
  await sendRoute(page, "ユーフォのルートを組んで");
  await expect(page.getByRole("list", { name: ja.route.timelineLabel })).toBeVisible();
}

test("no happy-path step opens the login dialog before the 保存する tap", async ({ page }) => {
  await page.route("**/v1/chat", (route) =>
    route.fulfill({ status: 200, headers: SSE_HEADERS, body: chatStreamRecording("clarify") }),
  );
  await openChat(page);
  await send(page, "ユーフォ");
  // The click returns before this turn's POST leaves the browser, so the
  // no-dialog assertion alone is no barrier: `unroute`/`route` land while the
  // request is still being built, the swapped-in handler answers THIS turn with
  // the route fixture, both turns render a route card, the E1 living-document
  // pass dims the first to 以前の版 — and the timeline locator below resolves to
  // two. The fixture would be wrong there, not the product, so wait for this
  // turn's own clarify answer (the escape hatch renders only once its final
  // envelope has landed) before the stub is exchanged underneath it.
  await expect(page.getByRole("button", { name: ja.clarify.escapeHatch })).toBeVisible();
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
  await page.route("**/api/auth/sign-in/magic-link", (route) => route.fulfill({ json: { status: true } }));
  await page.getByRole("textbox", { name: /メール|email/i }).fill("fan@example.com");
  await page.getByRole("button", { name: /ログインリンク|Send/i }).click();
  // Scoped to the form, not to the role: the page behind the modal reports its
  // own live region too — the chat's D7 map-load failure is a `role="status"`
  // (`error-states-i18n.ts`), and in this lane the tiles come from an
  // unroutable origin, so whether it has appeared by this point is a matter of
  // how fast the tile fetch fails. Unscoped, this assertion resolves to two
  // elements whenever it has.
  await expect(page.getByRole("form", { name: authJa.title }).getByRole("status")).toBeVisible();
  await page.getByRole("button", { name: /閉じる|Close/i }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

test("closing the wall after the link is sent keeps the intent — the mainline", async ({ page, context }) => {
  const bodies: unknown[] = [];
  await captureSaves(context, bodies);
  await planRoute(page);
  await page.getByRole("button", { name: ja.route.saveCta }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await sendLinkAndDismiss(page);

  // Going to read the email is not a cancellation: the intent must still be here.
  const stashed = await page.evaluate((key) => localStorage.getItem(key), DEFERRED_SAVE_KEY);
  expect(stashed).toContain("p1");

  const callbackTab = await openCallbackTab(context);
  await callbackTab.goto("/auth/callback");
  await expect.poll(() => bodies.length).toBe(1);
});

test("closing the wall before sending anything cancels the save", async ({ page, context }) => {
  const bodies: unknown[] = [];
  await captureSaves(context, bodies);
  await planRoute(page);
  await page.getByRole("button", { name: ja.route.saveCta }).click();
  await page.getByRole("button", { name: /閉じる|Close/i }).click();
  expect(await page.evaluate((key) => localStorage.getItem(key), DEFERRED_SAVE_KEY)).toBeNull();

  const callbackTab = await openCallbackTab(context);
  await callbackTab.goto("/auth/callback");
  await callbackTab.waitForURL((url) => url.pathname === "/");
  expect(bodies).toEqual([]);
});

test("the deferred intent survives a new tab of the same profile and replays once", async ({ page, context }) => {
  const bodies: unknown[] = [];
  await captureSaves(context, bodies);
  await planRoute(page);
  await page.getByRole("button", { name: ja.route.saveCta }).click();
  await expect(page.getByRole("dialog")).toBeVisible();

  // Origin-scoped, not tab-scoped: sessionStorage would be empty in the new tab.
  expect(await page.evaluate((key) => sessionStorage.getItem(key), DEFERRED_SAVE_KEY)).toBeNull();

  // The intent's survival into this tab is observable only through its replay:
  // the callback claims take-before-send (consume-once), so once the redeem has
  // run there is no live entry left to read — a localStorage read-back here
  // races the replay and loses once it wins (measured both ways across lanes).
  const callbackTab = await openCallbackTab(context);
  await callbackTab.goto("/auth/callback");
  await expect.poll(() => bodies.length).toBe(1);
  expect((bodies[0] as { point_ids: string[] }).point_ids).toEqual(["p1", "p2"]);
  // Consumed exactly once: the entry stays gone after the replay settled.
  await expect
    .poll(() => callbackTab.evaluate((key) => localStorage.getItem(key), DEFERRED_SAVE_KEY))
    .toBeNull();
});

test("a login the save CTA never started replays nothing", async ({ page, context }) => {
  const bodies: unknown[] = [];
  await captureSaves(context, bodies);
  await stubSignedInSession(page);
  await stubSessionAdopt(page);
  await page.goto("/auth/callback");
  // Deterministic signal: the callback navigates home only once the redeem —
  // and therefore the replay decision — has completed. No arbitrary wait.
  await page.waitForURL((url) => url.pathname === "/");
  expect(bodies).toEqual([]);
});

test("an expired deferred intent does not replay and is erased at the browser seam", async ({ page, context }) => {
  const bodies: unknown[] = [];
  await captureSaves(context, bodies);
  await stubSignedInSession(page);
  await stubSessionAdopt(page);
  // createdAt sits outside the 30-minute TTL: the callback must treat the
  // intent as abandoned rather than resurrecting a stale save.
  await stashIntent(page, Date.now() - DEFERRED_SAVE_TTL_MS - 60_000);
  await page.goto("/auth/callback");
  await page.waitForURL((url) => url.pathname === "/");
  expect(bodies).toEqual([]);
  expect(await page.evaluate((key) => localStorage.getItem(key), DEFERRED_SAVE_KEY)).toBeNull();
});

test("a failed replay surfaces the callback retry, and retry completes the save", async ({ page, context }) => {
  const bodies: unknown[] = [];
  await captureSaveWithRetry(context, bodies);
  await stubSignedInSession(page);
  await stubSessionAdopt(page);
  await stashIntent(page, Date.now());
  await page.goto("/auth/callback");
  await expect(page.getByRole("alert")).toBeVisible();
  await page.getByRole("button", { name: authJa.callback_save_retry }).click();
  await page.waitForURL((url) => url.pathname === "/");
  // The failed first attempt and the successful retry both recorded a POST.
  await expect.poll(() => bodies.length).toBe(2);
  expect((bodies[1] as { point_ids: string[] }).point_ids).toEqual(["p1", "p2"]);
});
