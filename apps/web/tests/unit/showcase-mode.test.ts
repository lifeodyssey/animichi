import { afterEach, describe, expect, it, vi } from "vitest";
import { isShowcase } from "../../src/features/config/showcase";
import { RUNTIME_CONFIG_GLOBAL_KEY } from "../../src/lib/runtime-config/provider";
import { DEFAULT_RUNTIME_CONFIG, parseRuntimeConfig } from "../../src/lib/runtime-config/runtime-config";

afterEach(() => { vi.unstubAllGlobals(); });

function withShowcase(value: string): void {
  vi.stubGlobal(RUNTIME_CONFIG_GLOBAL_KEY, { ...DEFAULT_RUNTIME_CONFIG, showcaseMode: value });
}

describe("runtime-config showcaseMode strict boolean contract (#1013 AC1)", () => {
  it("accepts exactly \"true\" and isShowcase reports on", () => {
    withShowcase("true");
    expect(isShowcase()).toBe(true);
  });

  it("accepts exactly \"false\" and isShowcase reports off", () => {
    withShowcase("false");
    expect(isShowcase()).toBe(false);
  });

  it("defaults to showcase off when no config is injected", () => {
    vi.stubGlobal(RUNTIME_CONFIG_GLOBAL_KEY, undefined);
    expect(isShowcase()).toBe(false);
  });

  it.each(["", "TRUE", "True", "False", "1", "0", "yes", "1".repeat(3)])(
    "rejects invalid value %j at parse, fail-closed",
    (value) => {
      expect(() => parseRuntimeConfig({ ...DEFAULT_RUNTIME_CONFIG, showcaseMode: value })).toThrow(
        /runtime config invalid/,
      );
    },
  );

  it("rejects a missing showcaseMode field at parse", () => {
    const { showcaseMode: _drop, ...rest } = DEFAULT_RUNTIME_CONFIG;
    expect(() => parseRuntimeConfig(rest)).toThrow(/runtime config invalid/);
  });
});
