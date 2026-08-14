import { describe, expect, it, vi } from "vitest";
import {
  currentRuntimeConfig,
  runtimeConfigFromServerEnv,
} from "../../../../src/lib/runtime-config/provider";
import {
  DEFAULT_RUNTIME_CONFIG,
  RUNTIME_CONFIG_SCHEMA_VERSION,
} from "../../../../src/lib/runtime-config/runtime-config";

// Node environment: no `window`, so the isomorphic resolver must reach the
// server-env `RUNTIME_CONFIG` binding. In a deploy the SSR Nitro plugin reads
// that binding and publishes it onto the shared global (#1013 merge-blocker);
// these tests pin the source precedence: an explicit server env wins, then the
// injected global, then the env-neutral default.

describe("runtime config in a server (node) environment", () => {
  it("currentRuntimeConfig defaults when no window and no binding exists", () => {
    expect(currentRuntimeConfig()).toEqual(DEFAULT_RUNTIME_CONFIG);
  });

  it("currentRuntimeConfig reads an explicit server-env binding first", () => {
    const binding = JSON.stringify({ ...DEFAULT_RUNTIME_CONFIG, showcaseMode: "true" });
    expect(currentRuntimeConfig({ RUNTIME_CONFIG: binding })).toEqual({
      ...DEFAULT_RUNTIME_CONFIG,
      showcaseMode: "true",
    });
  });

  it("currentRuntimeConfig ignores an empty server binding and defaults", () => {
    expect(currentRuntimeConfig({ RUNTIME_CONFIG: "" })).toEqual(DEFAULT_RUNTIME_CONFIG);
  });

  it("runtimeConfigFromServerEnv parses a valid binding", () => {
    const parsed = runtimeConfigFromServerEnv({
      RUNTIME_CONFIG: JSON.stringify({ schemaVersion: 1, showcaseMode: "false", featureFlags: {} }),
    });
    expect(parsed).toEqual(DEFAULT_RUNTIME_CONFIG);
    expect(parsed.schemaVersion).toBe(RUNTIME_CONFIG_SCHEMA_VERSION);
  });

  it("currentRuntimeConfig reads the live __env__ binding first on the server", () => {
    vi.stubGlobal("__env__", {
      RUNTIME_CONFIG: JSON.stringify({ ...DEFAULT_RUNTIME_CONFIG, showcaseMode: "true" }),
    });
    expect(currentRuntimeConfig()).toEqual({ ...DEFAULT_RUNTIME_CONFIG, showcaseMode: "true" });
  });

  it("currentRuntimeConfig defaults when __env__ is missing but the global is too", () => {
    vi.stubGlobal("__env__", undefined);
    expect(currentRuntimeConfig()).toEqual(DEFAULT_RUNTIME_CONFIG);
  });
});
