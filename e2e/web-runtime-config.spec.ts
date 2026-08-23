import { expect, test, type Page } from "@playwright/test";
import { RUNTIME_CONFIG_GLOBAL_KEY } from "../apps/web/src/lib/runtime-config/provider";

// AC2 (#1013): the ONE built artifact must render its runtime config through
// the REAL SSR->browser seed (a body-level inline <script> in __root.tsx), run
// correctly against staging- and production-shaped configs, and never leak
// cross-environment Auth/API origins or tokens. These tests pin that the
// served document genuinely carries the seed and that the browser resolves the
// exact values the served seed provides (not an addInitScript bypass).

test.use({ baseURL: process.env.E2E_WEB_BASE_URL ?? "http://localhost:3000" });

const STAGING = {
  schemaVersion: 1,
  api: { siteOrigin: "https://staging.animichi.com", catalogUrl: "https://catalog.staging.animichi.com", usersUrl: "https://users.staging.animichi.com", agentUrl: "https://agent.staging.animichi.com" },
  neonAuthBaseUrl: "https://auth.staging.animichi.com/neondb/auth",
  turnstileSiteKey: "2x00000000000000000000AA",
  showcaseMode: "false",
  cfBeaconToken: "11111111-1111-1111-1111-111111111111",
  featureFlags: { betaSearch: true },
};

const PRODUCTION = {
  schemaVersion: 1,
  api: { siteOrigin: "https://animichi.com", catalogUrl: "https://catalog.animichi.com", usersUrl: "https://users.animichi.com", agentUrl: "https://agent.animichi.com" },
  neonAuthBaseUrl: "https://auth.animichi.com/neondb/auth",
  turnstileSiteKey: "3x00000000000000000000AA",
  showcaseMode: "false",
  cfBeaconToken: "00000000-0000-0000-0000-000000000000",
  featureFlags: {},
};

/**
 * Mobile `/` replaces itself with `/chat`, whose polling means `networkidle`
 * never settles. The seed is emitted by `__root.tsx`, so every route carries
 * it; browser-side assertions use viewport-independent `/privacy`. The served
 * document check below still fetches `/`, the URL crawlers and deploys hit.
 */
const SEEDED_PATH = "/privacy";

// The served seed statement: window["__ANIMICHI_RUNTIME_CONFIG__"] ??= <json>;
// group 1 is the JSON object literal (balanced braces, no ';' inside).
const SEED_RE = /window\["__ANIMICHI_RUNTIME_CONFIG__"\] \?\?= ([^;]*);/;
const SEED_ASSIGN = "window[\"__ANIMICHI_RUNTIME_CONFIG__\"] ??= ";

// The served, UNMODIFIED document must carry the seed (Blocker A re-check).
test("the served document carries the runtime-config seed", async ({ page }) => {
  const response = await page.request.get("/");
  expect(response.ok()).toBe(true);
  const html = await response.text();
  expect(html).toContain(RUNTIME_CONFIG_GLOBAL_KEY);
  expect(SEED_RE.test(html)).toBe(true);
});

// Route the initial HTML through a seed-payload swap so the BROWSER parses a
// served document whose seed carries the requested fixture — exercising the
// real served-DOM seed path per environment.
async function serveWithSeed(page: Page, fixture: unknown): Promise<void> {
  const replacement = JSON.stringify(fixture);
  await page.route(`**${SEEDED_PATH}`, async (route) => {
    const response = await route.fetch();
    const body = await response.text();
    const seeded = body.replace(SEED_RE, SEED_ASSIGN + replacement + ";");
    await route.fulfill({ response, body: seeded, contentType: "text/html" });
  });
}

interface ServedResult {
  servedHtml: string;
  config: unknown;
}

// Navigate once and capture BOTH the served document body and the hydrated
// window global, so a test can assert the seed is in the SERVED HTML with the
// fixture values (not just in the runtime window).
async function served(page: Page): Promise<ServedResult> {
  const response = await page.goto(SEEDED_PATH);
  const servedHtml = (await response?.text()) ?? "";
  await page.waitForLoadState("networkidle");
  const config = await page.evaluate((key) => (window as Record<string, unknown>)[key], RUNTIME_CONFIG_GLOBAL_KEY);
  return { servedHtml, config };
}

test("a staging-shaped served seed runs the ONE artifact and leaks no production origin", async ({ page }) => {
  await serveWithSeed(page, STAGING);
  const { servedHtml, config } = await served(page);
  // The SERVED document must carry the seed with this fixture's values.
  expect(SEED_RE.test(servedHtml)).toBe(true);
  expect(servedHtml).toContain("staging.animichi.com");
  expect(servedHtml).toContain("2x00000000000000000000AA");
  const typed = config as typeof STAGING;
  expect(typed).toEqual(STAGING);
  const serialized = JSON.stringify(typed);
  expect(serialized).not.toContain("catalog.animichi.com");
  expect(serialized).not.toContain("00000000-0000-0000-0000-000000000000");
});

test("a production-shaped served seed runs the ONE artifact and leaks no staging origin", async ({ page }) => {
  await serveWithSeed(page, PRODUCTION);
  const { servedHtml, config } = await served(page);
  // The SERVED document must carry the seed with this fixture's values.
  expect(SEED_RE.test(servedHtml)).toBe(true);
  expect(servedHtml).toContain("catalog.animichi.com");
  expect(servedHtml).toContain("3x00000000000000000000AA");
  const typed = config as typeof PRODUCTION;
  expect(typed).toEqual(PRODUCTION);
  const serialized = JSON.stringify(typed);
  expect(serialized).not.toContain("staging.animichi.com");
  expect(serialized).not.toContain("11111111-1111-1111-1111-111111111111");
});
