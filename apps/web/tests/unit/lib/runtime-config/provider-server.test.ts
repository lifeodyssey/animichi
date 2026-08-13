import { describe, expect, it } from "vitest";
import { currentRuntimeConfig, runtimeConfigFromServerEnv } from "../../../../src/lib/runtime-config/provider";
import { DEFAULT_RUNTIME_CONFIG } from "../../../../src/lib/runtime-config/runtime-config";

// Node environment: no window, so the isomorphic resolver must fall back to an
// env-neutral default on the SSR side (#1013 AC1) until a server binding is
// wired (AC3+). An absent/empty binding is a default, never a crash.
describe("runtime config in a server (node) environment", () => {
  it("currentRuntimeConfig defaults when no window exists", () => {
    expect(currentRuntimeConfig()).toEqual(DEFAULT_RUNTIME_CONFIG);
  });

  it("server binding parses even in a node environment", () => {
    const parsed = runtimeConfigFromServerEnv({
      RUNTIME_CONFIG: JSON.stringify({ schemaVersion: 1, showcaseMode: "false", featureFlags: {} }),
    });
    expect(parsed).toEqual(DEFAULT_RUNTIME_CONFIG);
  });
});
