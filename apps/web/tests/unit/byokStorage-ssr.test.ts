/**
 * @vitest-environment node
 *
 * No `window` global exists in this environment (unlike jsdom), so this
 * pins the SSR half of the AC: importing byokStorage.ts and calling every
 * exported accessor must not throw, and every read must degrade to the
 * "no credential" answer rather than crash the render.
 */
import { describe, expect, it } from "vitest";
import {
  byokHeaders,
  clearByokConfig,
  getByokConfig,
  getByokVisionSupported,
  saveByokConfig,
  setByokVisionSupported,
} from "../../src/lib/byok/byokStorage";

describe("SSR safety — no window global available", () => {
  it("importing the module does not throw", () => {
    expect(typeof getByokConfig).toBe("function");
  });

  it("getByokConfig() returns null instead of throwing", () => {
    expect(getByokConfig()).toBeNull();
  });

  it("byokHeaders() returns {} instead of throwing", () => {
    expect(byokHeaders()).toEqual({});
  });

  it("saveByokConfig() succeeds as a no-op write instead of throwing", () => {
    expect(
      saveByokConfig({ provider: "anthropic", apiKey: "k", model: "claude-sonnet-4-5" }),
    ).toEqual({ ok: true });
    expect(getByokConfig()).toBeNull();
  });

  it("clearByokConfig() and the vision accessors are no-ops instead of throwing", () => {
    expect(() => {
      clearByokConfig();
    }).not.toThrow();
    expect(() => {
      setByokVisionSupported(true);
    }).not.toThrow();
    expect(getByokVisionSupported()).toBeNull();
  });
});
