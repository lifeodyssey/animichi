import { expect, test, type Page } from "@playwright/test";
import { RUNTIME_CONFIG_GLOBAL_KEY } from "../apps/web/src/lib/runtime-config/provider";

// AC2 (#1013): the ONE built web artifact must run correctly against a
// staging-shaped runtime config and a production-shaped runtime config via the
// single injected runtime-config seam, without leaking cross-environment
// Auth/API origins or tokens into each other. The seam is the versioned
// `window.__ANIMICHI_RUNTIME_CONFIG__` global the SSR render seeds and this
// suite injects per fixture; the config is the ONLY environment-varying public
// source (the versioned runtime schema, AC1).

test.use({ baseURL: process.env.E2E_WEB_BASE_URL ?? "http://localhost:3000" });

const STAGING = {
  schemaVersion: 1,
  api: {
    siteOrigin: "https://staging.animichi.com",
    catalogUrl: "https://catalog.staging.animichi.com",
    usersUrl: "https://users.staging.animichi.com",
    agentUrl: "https://agent.staging.animichi.com",
  },
  neonAuthBaseUrl: "https://auth.staging.animichi.com/neondb/auth",
  turnstileSiteKey: "2x00000000000000000000AA",
  showcaseMode: "false",
  cfBeaconToken: "11111111-1111-1111-1111-111111111111",
  featureFlags: { betaSearch: true },
};

const PRODUCTION = {
  schemaVersion: 1,
  api: {
    siteOrigin: "https://animichi.com",
    catalogUrl: "https://catalog.animichi.com",
    usersUrl: "https://users.animichi.com",
    agentUrl: "https://agent.animichi.com",
  },
  neonAuthBaseUrl: "https://auth.animichi.com/neondb/auth",
  turnstileSiteKey: "3x00000000000000000000AA",
  showcaseMode: "false",
  cfBeaconToken: "00000000-0000-0000-0000-000000000000",
  featureFlags: {},
};

async function injectConfig(page: Page, config: unknown): Promise<void> {
  // addInitScript takes a single optional arg, so the key and payload travel
  // together. It runs before every page script (including the SSR-injected
  // global seed); the seed uses `?? ` so this fixture wins and is never
  // re-baked over.
  await page.addInitScript(({ key, payload }) => {
    (window as Record<string, unknown>)[key] = payload;
  }, { key: RUNTIME_CONFIG_GLOBAL_KEY, payload: config });
}

async function loadedConfig(page: Page): Promise<unknown> {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  return page.evaluate((key) => (window as Record<string, unknown>)[key], RUNTIME_CONFIG_GLOBAL_KEY);
}

test("a staging runtime config runs the ONE artifact and leaks no production origin", async ({ page }) => {
  await injectConfig(page, STAGING);
  const config = (await loadedConfig(page)) as typeof STAGING;
  expect(config).toEqual(STAGING);
  const serialized = JSON.stringify(config);
  expect(serialized).not.toContain("catalog.animichi.com");
  expect(serialized).not.toContain("auth.animichi.com");
  expect(serialized).not.toContain("00000000-0000-0000-0000-000000000000");
});

test("a production runtime config runs the ONE artifact and leaks no staging origin", async ({ page }) => {
  await injectConfig(page, PRODUCTION);
  const config = (await loadedConfig(page)) as typeof PRODUCTION;
  expect(config).toEqual(PRODUCTION);
  const serialized = JSON.stringify(config);
  expect(serialized).not.toContain("staging.animichi.com");
  expect(serialized).not.toContain("auth.staging.animichi.com");
  expect(serialized).not.toContain("11111111-1111-1111-1111-111111111111");
});
