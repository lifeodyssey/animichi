import { describe, expect, it } from "vitest";
import {
  DEFAULT_RUNTIME_CONFIG,
  RUNTIME_CONFIG_SCHEMA_VERSION,
  parseRuntimeConfig,
  type RuntimeConfigErrorCode,
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

function codeOf(fn: () => unknown): RuntimeConfigErrorCode | undefined {
  try {
    fn();
    return undefined;
  } catch (error) {
    if (error instanceof Error && "code" in error) return (error as { code: RuntimeConfigErrorCode }).code;
    throw error;
  }
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
    expect(codeOf(() => parseRuntimeConfig({ ...PROD, schemaVersion: 2 }))).toBe("wrong_version");
  });

  it("REJECTS a missing schema_version", () => {
    const { schemaVersion: _drop, ...rest } = PROD;
    expect(codeOf(() => parseRuntimeConfig(rest))).toBe("wrong_version");
  });

  it("REJECTS unknown top-level fields (strict contract)", () => {
    expect(codeOf(() => parseRuntimeConfig({ ...PROD, injectedSecret: "hunter2" }))).toBe(
      "unknown_field",
    );
  });

  it("REJECTS non-object input", () => {
    expect(codeOf(() => parseRuntimeConfig("not-json"))).toBe("invalid_json");
  });

  it("REJECTS a JSON string that is not an object", () => {
    expect(codeOf(() => parseRuntimeConfig("[1,2]"))).toBe("invalid");
  });

  it("REJECTS missing/typed showcaseMode on an otherwise-false config", () => {
    expect(codeOf(() => parseRuntimeConfig({ schemaVersion: 1 }))).toBe("invalid");
    expect(codeOf(() => parseRuntimeConfig({ schemaVersion: 1, showcaseMode: "TRUE" }))).toBe("invalid");
  });

  it("REJECTS a non-boolean feature flag value", () => {
    expect(
      codeOf(() => parseRuntimeConfig({ ...PROD, featureFlags: { newChat: "yes" } })),
    ).toBe("invalid");
  });
});
