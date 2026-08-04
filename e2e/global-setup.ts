import { chromium } from "@playwright/test";

const stagingGateStatePath = "e2e/.auth/staging-gate.json";
const stagingCookieDefaults = {
  path: "/",
  secure: true,
  httpOnly: false,
  sameSite: "Lax" as const,
};

function parseBaseUrl(rawUrl: string | undefined): URL {
  if (!rawUrl) {
    throw new Error("E2E_WEB_BASE_URL must be set when STAGING_GATE_TOKEN is set.");
  }
  try {
    return new URL(rawUrl);
  } catch {
    throw new Error(`E2E_WEB_BASE_URL must be a valid URL: ${rawUrl}`);
  }
}

function assertAllowedProtocol(url: URL): void {
  if (url.protocol === "http:" && url.hostname !== "localhost") {
    throw new Error(
      "E2E_WEB_BASE_URL must use HTTPS for non-localhost hosts when STAGING_GATE_TOKEN is set.",
    );
  }
}

function createStagingCookie(token: string, hostname: string) {
  return {
    ...stagingCookieDefaults,
    name: "animichi_staging",
    value: token,
    domain: hostname,
  };
}

async function writeStorageState(token: string, hostname: string): Promise<void> {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    await context.addCookies([createStagingCookie(token, hostname)]);
    await context.storageState({ path: stagingGateStatePath });
  } finally {
    await browser.close();
  }
}

export default async function globalSetup(): Promise<void> {
  const token = process.env.STAGING_GATE_TOKEN;
  if (!token) return;
  const baseUrl = parseBaseUrl(process.env.E2E_WEB_BASE_URL);
  assertAllowedProtocol(baseUrl);
  await writeStorageState(token, baseUrl.hostname);
}
