import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { chatSearchPath } from "../apps/web/src/components/home/search-target";

/**
 * GOAL C #41 (C13) — hero search query survival on staging (non-showcase):
 * submitting the hero search must carry `?q=…` through the magic-link login as
 * a post-login return target, so the callback lands on `/chat?q=…` (journey
 * §1-A②) with the query escaped — `&`, `#`, and spaces stay inside `q`. The
 * showcase build intercepts the same submit with the ComingSoonPopup instead
 * (C1) and never sends a link, so the dialog's magic-link form is the
 * non-showcase proof: it can only be filled when the login modal rendered.
 *
 * Prerequisite: `VITE_NEON_AUTH_BASE_URL` must be set for the app under test,
 * or `sendMagicLink` reports "not configured" without emitting a request and
 * the captured-body assertion fails (same contract as
 * web-chat-save-login-wall.spec.ts). The VALUE is irrelevant: every Neon Auth
 * request is intercepted below, so any non-empty string keeps the login form
 * live. CI sets a placeholder for exactly this reason.
 */
test.use({
  baseURL: process.env.E2E_WEB_BASE_URL ?? "http://localhost:3000",
  locale: "ja-JP",
});

/** A query whose `&` and `#` must survive encoding as literal characters. */
const QUERY = "君の名は。 & #";

/**
 * Hydration barrier, same contract as web-chat-save-login-wall.spec.ts:50-53
 * but keyed to the landing's one post-hydration request: the root-route auth
 * gate (`lib/auth/session.ts`) fires `GET {authBase}/api/auth/get-session`
 * only after React has taken over the SSR markup. Clicking before that resets
 * the controlled input and drops the submit handler — the all-red failure mode
 * of the earlier revision. The splash cannot serve as the barrier: its
 * dismissal is CSS-timed and finishes BEFORE hydration (verified: 2/3 red
 * when used). The waiver must be armed before `goto` or it misses the
 * response.
 *
 * The stub is a 401 on purpose: an intercepted 200 `{ session: null, user:
 * null }` was observed to be parsed as an authenticated session by the
 * better-auth client, which renders AppHome instead of the landing and makes
 * the hero unreachable. 401 keeps the app on the anonymous Landing while
 * still producing a real response for `waitForResponse`.
 */
async function waitForHydration(page: Page): Promise<void> {
  await page.route("**/api/auth/get-session", (route) =>
    route.fulfill({ status: 401, json: { error: "no session" } }),
  );
  const hydrated = page.waitForResponse((response) => response.url().includes("/get-session"));
  await page.goto("/");
  await hydrated;
}

/** Record every magic-link POST body the app emits, answering success. */
async function captureMagicLinks(context: BrowserContext, bodies: unknown[]): Promise<void> {
  await context.route("**/magic-link*", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    bodies.push(route.request().postDataJSON());
    return route.fulfill({ json: { status: true } });
  });
}

async function submitHeroSearch(page: Page, query: string): Promise<void> {
  await waitForHydration(page);
  const search = page.getByRole("textbox", { name: "アニメ・駅・都市を入力" });
  await expect(search).toBeVisible();
  if (query) await search.fill(query);
  await page.getByRole("button", { name: "巡礼をはじめる" }).first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
}

async function sendMagicLink(page: Page, bodies: unknown[]): Promise<void> {
  await page.getByRole("textbox", { name: /メール|email/i }).fill("fan@example.com");
  await page.getByRole("button", { name: /ログインリンク|Send/i }).click();
  await expect.poll(() => bodies.length).toBe(1);
}

function callbackUrlOf(body: unknown): string {
  const callbackURL = (body as { callbackURL: string }).callbackURL;
  expect(callbackURL).toBeDefined();
  return callbackURL;
}

test("a typed hero query survives login as an escaped /chat?q= return target", async ({ page, context }) => {
  const bodies: unknown[] = [];
  await captureMagicLinks(context, bodies);
  await submitHeroSearch(page, QUERY);
  await sendMagicLink(page, bodies);

  const callback = new URL(callbackUrlOf(bodies[0]));
  expect(callback.pathname).toBe("/auth/callback");

  const next = callback.searchParams.get("next");
  if (next === null) throw new Error("magic-link callbackURL lost the next return target");
  // `searchParams.get` already decodes the first level (the outer
  // `encodeURIComponent` in callbackUrl), so `next` must be exactly the
  // path the app handed over: `/chat?q=<encodeURIComponent(query)>`.
  expect(next).toBe(chatSearchPath(QUERY));

  // Escaping proof: `&` and `#` inside the query must not split the `q` param.
  const q = new URLSearchParams(next.slice(next.indexOf("?"))).get("q");
  expect(q).toBe(QUERY);
});

test("an empty hero submit sends a plain /auth/callback with no ?q=", async ({ page, context }) => {
  const bodies: unknown[] = [];
  await captureMagicLinks(context, bodies);
  await submitHeroSearch(page, "");
  await sendMagicLink(page, bodies);

  expect(callbackUrlOf(bodies[0])).toBe(`${new URL(page.url()).origin}/auth/callback`);
});
