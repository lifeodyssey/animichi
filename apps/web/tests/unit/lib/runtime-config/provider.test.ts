/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  currentRuntimeConfig,
  runtimeConfigFromClient,
  runtimeConfigFromServerEnv,
} from "../../../../src/lib/runtime-config/provider";
import { DEFAULT_RUNTIME_CONFIG } from "../../../../src/lib/runtime-config/runtime-config";

const WINDOW_KEY = "__ANIMICHI_RUNTIME_CONFIG__";

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

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("runtimeConfigFromClient", () => {
  it("returns the injected window global object verbatim", () => {
    vi.stubGlobal(WINDOW_KEY, STAGING);
    expect(runtimeConfigFromClient()).toEqual(STAGING);
  });

  it("parses a JSON-string global into the typed contract", () => {
    vi.stubGlobal(WINDOW_KEY, JSON.stringify(STAGING));
    expect(runtimeConfigFromClient()).toEqual(STAGING);
  });

  it("defaults when no global is present", () => {
    vi.stubGlobal(WINDOW_KEY, undefined);
    expect(runtimeConfigFromClient()).toEqual(DEFAULT_RUNTIME_CONFIG);
  });
});

describe("runtimeConfigFromServerEnv", () => {
  it("parses a structured RUNTIME_CONFIG JSON bound on the server", () => {
    const env = { RUNTIME_CONFIG: JSON.stringify(STAGING) };
    expect(runtimeConfigFromServerEnv(env)).toEqual(STAGING);
  });

  it("defaults when the server binding is absent", () => {
    expect(runtimeConfigFromServerEnv({})).toEqual(DEFAULT_RUNTIME_CONFIG);
    expect(runtimeConfigFromServerEnv({ RUNTIME_CONFIG: "" })).toEqual(DEFAULT_RUNTIME_CONFIG);
  });
});

describe("currentRuntimeConfig", () => {
  it("resolves the browser global in a browser-like environment", () => {
    vi.stubGlobal(WINDOW_KEY, STAGING);
    expect(currentRuntimeConfig()).toEqual(STAGING);
  });
});
