import { afterEach, describe, expect, it, vi } from "vitest";

function loadShowcase(value: string | undefined): Promise<typeof import("../../src/features/config/showcase")> {
  if (value === undefined) {
    vi.stubEnv("VITE_SHOWCASE_MODE", undefined);
  } else {
    vi.stubEnv("VITE_SHOWCASE_MODE", value);
  }
  vi.resetModules();
  return import("../../src/features/config/showcase");
}

afterEach(() => { vi.unstubAllEnvs(); });

describe("VITE_SHOWCASE_MODE strict boolean contract", () => {
  it("accepts exactly \"true\" and reports showcase on", async () => {
    const { isShowcase } = await loadShowcase("true");
    expect(isShowcase()).toBe(true);
  });

  it("accepts exactly \"false\" and reports showcase off", async () => {
    const { isShowcase } = await loadShowcase("false");
    expect(isShowcase()).toBe(false);
  });

  it.each([
    "",
    "TRUE",
    "True",
    "False",
    "1",
    "0",
    "yes",
    "no",
    " true",
    "true ",
    "true\n",
  ])("throws at module init for invalid value %j", async (value) => {
    await expect(loadShowcase(value)).rejects.toThrow(/VITE_SHOWCASE_MODE/);
  });

  it("throws at module init when the key is unset", async () => {
    await expect(loadShowcase(undefined)).rejects.toThrow(/VITE_SHOWCASE_MODE/);
  });
});
