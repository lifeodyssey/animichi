import { describe, expect, it } from "vitest";
import {
  DEFAULT_RUNTIME_CONFIG,
  RUNTIME_CONFIG_SCHEMA_VERSION,
  parseRuntimeConfig,
} from "../../../../src/lib/runtime-config/runtime-config";

/** A complete, valid production-shaped config. */
const PROD = {
  schemaVersion: 1,
  api: {
    siteOrigin: "https://animichi.com",
    catalogUrl: "https://animichi.com",
    usersUrl: "https://animichi.com",
    agentUrl: "https://animichi.com",
  },
  neonAuthBaseUrl: "https://auth.animichi.com/neondb/auth",
  turnstileSiteKey: "0x4AAAAAAAsitekey24chars",
  showcaseMode: "false",
  cfBeaconToken: "00000000-0000-0000-0000-000000000000",
  featureFlags: {},
};

// Conditional-free rejection helper: asserts the loader throws with the typed
// runtime-config error prefix naming the failure code.
function rejectsWith(raw: unknown, code: string): void {
  expect(() => parseRuntimeConfig(raw)).toThrow(`runtime config ${code}:`);
}

describe("parseRuntimeConfig schema versioning", () => {
  it("parses a valid v1 config unchanged", () => {
    expect(parseRuntimeConfig(PROD)).toEqual(PROD);
    expect(parseRuntimeConfig(PROD).schemaVersion).toBe(RUNTIME_CONFIG_SCHEMA_VERSION);
  });

  it("defaults on missing input", () => {
    expect(parseRuntimeConfig(undefined)).toEqual(DEFAULT_RUNTIME_CONFIG);
    expect(parseRuntimeConfig(null)).toEqual(DEFAULT_RUNTIME_CONFIG);
  });

  it("defaults all optional origin and token fields when omitted", () => {
    const parsed = parseRuntimeConfig({ schemaVersion: 1, showcaseMode: "false", featureFlags: {} });
    expect(parsed).toEqual(DEFAULT_RUNTIME_CONFIG);
  });

  it("REJECTS a future/bad schema_version", () => {
    rejectsWith({ ...PROD, schemaVersion: 2 }, "wrong_version");
  });

  it("REJECTS a missing schema_version", () => {
    const { schemaVersion: _drop, ...rest } = PROD;
    rejectsWith(rest, "wrong_version");
  });

  it("REJECTS unknown top-level fields (strict contract)", () => {
    rejectsWith({ ...PROD, injectedSecret: "hunter2" }, "unknown_field");
  });

  it("REJECTS unknown nested keys inside api (strict api contract)", () => {
    rejectsWith({ ...PROD, api: { ...PROD.api, saiteOrigin: "https://x.test" } }, "unknown_field");
  });

  it("REJECTS non-object input", () => {
    rejectsWith("not-json", "invalid_json");
  });

  it("REJECTS a JSON string that is not an object", () => {
    rejectsWith("[1,2]", "invalid");
  });

  it("REJECTS missing/typed showcaseMode on an otherwise-false config", () => {
    rejectsWith({ schemaVersion: 1 }, "invalid");
    rejectsWith({ schemaVersion: 1, showcaseMode: "TRUE" }, "invalid");
  });

  it("REJECTS a non-boolean feature flag value", () => {
    rejectsWith({ ...PROD, featureFlags: { newChat: "yes" } }, "invalid");
  });
});

describe("turnstileSiteKey public-key shape", () => {
  it.each([
    "1x00000000000000000000AA",
    "2x00000000000000000000AA",
    "3x00000000000000000000AA",
    "0x4AAAAAAAsitekey24chars",
  ])("accepts the 24-char alphanumeric production/CI key %s", (siteKey) => {
    expect(parseRuntimeConfig({ ...PROD, turnstileSiteKey: siteKey }).turnstileSiteKey).toBe(siteKey);
  });

  it.each([
    "0x4AAAAAAAsitekey24ch",
    "not-a-site-key",
    "0x4AAAAAAAsitekey24chars!",
    "this is far too long for a site key indeed",
  ])("rejects a malformed site key %s", (siteKey) => {
    rejectsWith({ ...PROD, turnstileSiteKey: siteKey }, "invalid");
  });
});
