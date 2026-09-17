import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { chromium, expect, type Page } from "@playwright/test";
import { RUNTIME_CONFIG_GLOBAL_KEY } from "../../../apps/web/src/lib/runtime-config/provider.ts";
import { nativeWebServer } from "../../../apps/web/tests/native-server.ts";
import { stubTurnstileSdk } from "../../../e2e/helpers/turnstile-sdk.ts";
import { ADOPT_TURN_KEY_PREFIX } from "../src/identity/session-adopt.ts";
import type { SessionAdoptionResult } from "../src/identity/session-adoption-store.ts";
import { gatewayWorker } from "./gateway-harness.ts";
import { pool } from "./postgres.ts";

/**
 * #1601 AC5 as a live browser assertion: the login-wall callback adopts this
 * browser's anonymous conversation at the edge.
 *
 * The AC names `e2e/web-chat-save-login-wall.spec.ts:92`, which stubs the
 * "/v1/sessions/adopt" route with a fulfilled body — a spec green whether or
 * not the native adoption works, because it asserts against its own stub, and
 * that lane holds no edge to point at instead (`e2e/AGENTS.md`: every transport
 * is doubled). This arm keeps the browser and the app but replaces the stub
 * with the deployed entry point (`gateway-harness.ts`): the app's own callback
 * runs `establish` and then `adoptSessions`, so the real POST resolves the
 * browser's signed `aid` cookie, verifies the account JWT, passes the rate
 * guard, and performs the ownership `UPDATE` and marker insert against the
 * arm's disposable PostgreSQL. Only external boundaries are scripted: the Neon
 * Auth session endpoint, its JWKS and Turnstile siteverify.
 */

const ACCOUNT_ID = "host-integration-account";
const SESSION = "01992000-0000-7000-8000-000000001601";
const THIRD_PARTY_SESSION = "01992000-0000-7000-8000-000000001602";
const THIRD_PARTY_ID = "third-party-account";
const FIRST_QUERY = "Find the Uji pilgrimage";
const TURNSTILE_SITE_KEY = "1x00000000000000000000AA";
const ADOPT_PATH = "/v1/sessions/adopt";

function isPath(pathname: string) {
  return (response: { url(): string }) => new URL(response.url()).pathname === pathname;
}

async function solveEntry(page: Page): Promise<void> {
  await page.waitForFunction("typeof window.onAnimichiTurnstile === 'function'");
  await page.evaluate("window.onAnimichiTurnstile('host-integration-entry')");
}

/** Anonymous first: the app's own entry gate drives the real
 *  `/v1/turnstile/verify`, and the edge mints this browser its `aid` cookie. */
async function anonymousPage(context: TestContext, baseURL: string): Promise<Page> {
  const browser = await chromium.launch({ headless: true });
  context.after(() => browser.close());
  const page = await browser.newPage({ baseURL, locale: "en-US", viewport: { width: 1280, height: 900 } });
  await stubTurnstileSdk(page);
  await page.route("**/healthz", (route) => route.fulfill({ status: 200, body: "healthy" }));
  await page.goto("/chat");
  await solveEntry(page);
  await expect(page.getByRole("textbox")).toBeEnabled();
  return page;
}

/** Neon Auth is the external identity provider this arm scripts. The SSR seed
 *  carries the origin into the browser, so the app's SDK path is the real one.
 *  Set AFTER the anonymous visit: the browser must earn its `aid` cookie as an
 *  anonymous visitor, exactly as the login wall's flow has it. */
function configureIdentityProvider(origin: string): void {
  Reflect.set(globalThis, RUNTIME_CONFIG_GLOBAL_KEY, {
    schemaVersion: 1, api: {}, neonAuthBaseUrl: origin,
    turnstileSiteKey: TURNSTILE_SITE_KEY, showcaseMode: "false", featureFlags: {},
  });
}

/** The identity the edge minted for this browser: the pass gate above ran the
 *  real anonymous entry, so this is the browser's own signed cookie, not a
 *  value the test constructed. */
async function anonymousIdentity(page: Page): Promise<string> {
  const aid = (await page.context().cookies()).find((cookie) => cookie.name === "aid");
  assert.ok(aid, "the edge minted this browser an anonymous identity");
  assert.equal(aid.httpOnly, true);
  const [id] = aid.value.split(".");
  assert.ok(id, "the anonymous cookie carries an id");
  return `anon_${id}`;
}

async function clearRows(): Promise<void> {
  await pool.query("DELETE FROM turn_reservations WHERE session_id = ANY($1)", [[SESSION, THIRD_PARTY_SESSION]]);
  await pool.query("DELETE FROM sessions WHERE id = ANY($1)", [[SESSION, THIRD_PARTY_SESSION]]);
}

/** The anonymous conversation this browser owns, plus a third party's row that
 *  must not move. The row is the shape native admission writes. */
async function seedConversations(anonId: string): Promise<void> {
  await clearRows();
  await pool.query("INSERT INTO sessions (id, user_id, first_query) VALUES ($1, $2, $3)", [SESSION, anonId, FIRST_QUERY]);
  await pool.query("INSERT INTO sessions (id, user_id, first_query) VALUES ($1, $2, $3)", [THIRD_PARTY_SESSION, THIRD_PARTY_ID, "A stranger's trip"]);
}

interface OwnerRow { readonly id: string; readonly user_id: string | null }

async function owners(): Promise<OwnerRow[]> {
  const rows = await pool.query<OwnerRow>("SELECT id, user_id FROM sessions WHERE id = ANY($1) ORDER BY id", [[SESSION, THIRD_PARTY_SESSION]]);
  return rows.rows;
}

async function markerKeys(): Promise<string[]> {
  const rows = await pool.query<{ turn_key: string }>("SELECT turn_key FROM turn_reservations WHERE session_id = $1", [SESSION]);
  return rows.rows.map((row) => row.turn_key);
}

/** The callback page redirects the moment the adopt response lands, so any body
 *  read through the browser afterwards can hit `Network.getResponseBody: ...
 *  navigated away from` — #1754's `waitForResponse` continuation still did
 *  that. `route.fetch()` reads the body into Playwright's own store, and
 *  `fulfill({ response })` replays it to the page, so no browser-owned body is
 *  ever read. */
async function recordAdoptBodies(page: Page): Promise<{ readonly bodies: Promise<SessionAdoptionResult>[] }> {
  const bodies: Promise<SessionAdoptionResult>[] = [];
  await page.route((url) => url.pathname === ADOPT_PATH, async (route) => {
    const response = await route.fetch();
    bodies.push(response.json() as Promise<SessionAdoptionResult>);
    await route.fulfill({ response });
  });
  return { bodies };
}

/** Open the browser lane's anonymous visitor with the live adoption reachable. */
async function liveVisitor(context: TestContext, accountId: string) {
  const gateway = await gatewayWorker(context, accountId);
  const baseURL = await nativeWebServer(context, await gateway.worker.ready);
  const page = await anonymousPage(context, baseURL);
  await seedConversations(await anonymousIdentity(page));
  configureIdentityProvider(gateway.neonAuthOrigin);
  context.after(() => { Reflect.deleteProperty(globalThis, RUNTIME_CONFIG_GLOBAL_KEY); });
  return page;
}

void test("the login-wall callback adopts the browser's anonymous conversation at the edge", { timeout: 180_000 }, async (context) => {
  const page = await liveVisitor(context, ACCOUNT_ID);
  const adopt = await recordAdoptBodies(page);
  const adoptLanded = page.waitForResponse(isPath(ADOPT_PATH));
  await page.goto("/auth/callback");
  await adoptLanded;
  assert.deepEqual(await adopt.bodies[0], { adopted: 1, noop_class: "adopted", revisions_bumped: 1 });
  await expect.poll(() => new URL(page.url()).pathname).toBe("/");
  assert.deepEqual(await owners(), [{ id: SESSION, user_id: ACCOUNT_ID }, { id: THIRD_PARTY_SESSION, user_id: THIRD_PARTY_ID }]);
  assert.deepEqual(await markerKeys(), [`${ADOPT_TURN_KEY_PREFIX}${SESSION}`]);

  const listed = page.waitForResponse(isPath("/v1/conversations"));
  await page.goto("/chat");
  assert.equal((await listed).status(), 200);
  await expect(page.getByRole("link", { name: FIRST_QUERY })).toBeVisible();
});

void test("a repeated callback visit adopts nothing further and moves no rows", { timeout: 180_000 }, async (context) => {
  const page = await liveVisitor(context, ACCOUNT_ID);
  const adopt = await recordAdoptBodies(page);
  const first = page.waitForResponse(isPath(ADOPT_PATH));
  await page.goto("/auth/callback");
  await first;
  const second = page.waitForResponse(isPath(ADOPT_PATH));
  await page.goto("/auth/callback");
  await second;
  assert.deepEqual(await adopt.bodies[0], { adopted: 1, noop_class: "adopted", revisions_bumped: 1 });
  assert.deepEqual(await adopt.bodies[1], { adopted: 0, noop_class: "no_rows", revisions_bumped: 0 });
  assert.equal(adopt.bodies.length, 2);
  assert.deepEqual(await owners(), [{ id: SESSION, user_id: ACCOUNT_ID }, { id: THIRD_PARTY_SESSION, user_id: THIRD_PARTY_ID }]);
  assert.deepEqual(await markerKeys(), [`${ADOPT_TURN_KEY_PREFIX}${SESSION}`]);
});
