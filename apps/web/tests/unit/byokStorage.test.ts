/**
 * @vitest-environment jsdom
 *
 * Core persistence, header emission, vision-flag lockstep. Validation and
 * field-safety rules live in byokStorage-validation.test.ts /
 * byokStorage-field-safety.test.ts; storage-failure modes live in
 * byokStorage-security-error.test.ts (split for the ~200-line file budget).
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  BYOK_DEFAULT_MODEL,
  byokHeaders,
  clearByokConfig,
  getByokConfig,
  getByokVisionSupported,
  saveByokConfig,
  setByokVisionSupported,
} from "../../src/lib/byok/byokStorage";
import type { ByokConfig } from "../../src/lib/byok/byokStorage";

const OPENAI_CONFIG: ByokConfig = {
  provider: "openai-compatible",
  apiKey: "sk-test-key",
  model: "gpt-5",
  baseUrl: "https://api.example.com/v1",
};

const ANTHROPIC_CONFIG: ByokConfig = {
  provider: "anthropic",
  apiKey: "anthropic-key",
  model: BYOK_DEFAULT_MODEL.anthropic,
};

const GEMINI_CONFIG: ByokConfig = {
  provider: "gemini",
  apiKey: "gemini-key",
  model: BYOK_DEFAULT_MODEL.gemini,
};

afterEach(() => {
  clearByokConfig();
});

describe("happy path — persistence (X10)", () => {
  it("saves and reads back an openai-compatible config", () => {
    expect(saveByokConfig(OPENAI_CONFIG)).toEqual({ ok: true });
    expect(getByokConfig()).toEqual(OPENAI_CONFIG);
  });

  it("routes the write through sessionStorage only, never localStorage", () => {
    window.localStorage.clear();
    saveByokConfig(OPENAI_CONFIG);
    expect(window.sessionStorage.getItem("animichi.byok.config")).not.toBeNull();
    expect(window.localStorage.length).toBe(0);
  });
});

describe("happy path — sessionHeaders() header emission", () => {
  it("emits Provider/Key/Model/Base-Url for openai-compatible", () => {
    saveByokConfig(OPENAI_CONFIG);
    expect(byokHeaders()).toEqual({
      "X-BYOK-Provider": "openai-compatible",
      "X-BYOK-Key": "sk-test-key",
      "X-BYOK-Model": "gpt-5",
      "X-BYOK-Base-Url": "https://api.example.com/v1",
    });
  });

  it("omits Base-Url for anthropic", () => {
    saveByokConfig(ANTHROPIC_CONFIG);
    expect(byokHeaders()).toEqual({
      "X-BYOK-Provider": "anthropic",
      "X-BYOK-Key": "anthropic-key",
      "X-BYOK-Model": BYOK_DEFAULT_MODEL.anthropic,
    });
  });

  it("omits Base-Url for gemini", () => {
    saveByokConfig(GEMINI_CONFIG);
    expect(byokHeaders()).toEqual({
      "X-BYOK-Provider": "gemini",
      "X-BYOK-Key": "gemini-key",
      "X-BYOK-Model": BYOK_DEFAULT_MODEL.gemini,
    });
  });

  it("omits Base-Url for anthropic even if a stray baseUrl value is present", () => {
    // Guards the provider check independently of "baseUrl happens to be
    // undefined" — a config object could carry a baseUrl for the wrong
    // family, and the header must still be family-gated, not just
    // presence-gated.
    saveByokConfig({ ...ANTHROPIC_CONFIG, baseUrl: "https://sneaky.example.com" });
    expect(byokHeaders()).toEqual({
      "X-BYOK-Provider": "anthropic",
      "X-BYOK-Key": "anthropic-key",
      "X-BYOK-Model": BYOK_DEFAULT_MODEL.anthropic,
    });
  });

  it("emits {} with no config saved", () => {
    expect(byokHeaders()).toEqual({});
  });
});

describe("happy path — Base-Url edge cases", () => {
  it("omits Base-Url for openai-compatible when baseUrl is empty/whitespace (P3)", () => {
    saveByokConfig({ ...OPENAI_CONFIG, baseUrl: "" });
    expect(byokHeaders()).toEqual({
      "X-BYOK-Provider": "openai-compatible",
      "X-BYOK-Key": "sk-test-key",
      "X-BYOK-Model": "gpt-5",
    });
    saveByokConfig({ ...OPENAI_CONFIG, baseUrl: "   " });
    expect(byokHeaders()).toEqual({
      "X-BYOK-Provider": "openai-compatible",
      "X-BYOK-Key": "sk-test-key",
      "X-BYOK-Model": "gpt-5",
    });
  });
});

describe("happy path — vision flag lockstep with clearByokConfig()", () => {
  it("keeps a set vision flag until an explicit clear", () => {
    saveByokConfig(OPENAI_CONFIG);
    setByokVisionSupported(true);
    expect(getByokVisionSupported()).toBe(true);
    clearByokConfig();
    expect(getByokVisionSupported()).toBeNull();
  });

  it("clears the vision flag when the config is overwritten with a new key", () => {
    saveByokConfig(OPENAI_CONFIG);
    setByokVisionSupported(true);
    saveByokConfig({ ...OPENAI_CONFIG, apiKey: "sk-different-key" });
    expect(getByokVisionSupported()).toBeNull();
  });

  it("distinguishes an unprobed credential (null) from a probed-false one", () => {
    saveByokConfig(OPENAI_CONFIG);
    expect(getByokVisionSupported()).toBeNull();
    setByokVisionSupported(false);
    expect(getByokVisionSupported()).toBe(false);
  });

  it("does not write an orphaned vision flag when no config is saved (probe-after-clear race, Opus P1-2)", () => {
    // A probe that resolves after clearByokConfig() (or before any config was
    // ever saved) must not leave a vision flag with nothing to attach to —
    // otherwise a later, unrelated saveByokConfig() could inherit a stale
    // "vision supported" flag it never earned.
    setByokVisionSupported(true);
    expect(getByokVisionSupported()).toBeNull();
    saveByokConfig(OPENAI_CONFIG);
    expect(getByokVisionSupported()).toBeNull();
  });
});

describe("null/empty — SSR safety and corrupt storage", () => {
  it("returns null for an absent config", () => {
    expect(getByokConfig()).toBeNull();
  });

  it("returns null for non-JSON stored garbage", () => {
    window.sessionStorage.setItem("animichi.byok.config", "not json{{");
    expect(getByokConfig()).toBeNull();
  });

  it("returns null for well-formed JSON missing required fields", () => {
    window.sessionStorage.setItem("animichi.byok.config", JSON.stringify({ provider: "anthropic" }));
    expect(getByokConfig()).toBeNull();
  });

  it("returns null for an unknown provider value", () => {
    window.sessionStorage.setItem(
      "animichi.byok.config",
      JSON.stringify({ provider: "made-up", apiKey: "k", model: "m" }),
    );
    expect(getByokConfig()).toBeNull();
  });

  it("returns null when the stored value is valid JSON but not an object (a bare number)", () => {
    window.sessionStorage.setItem("animichi.byok.config", "42");
    expect(getByokConfig()).toBeNull();
  });

  it("returns null when the stored value is valid JSON `null`", () => {
    window.sessionStorage.setItem("animichi.byok.config", "null");
    expect(getByokConfig()).toBeNull();
  });

  it("byokHeaders() returns {} when the stored value is corrupt", () => {
    window.sessionStorage.setItem("animichi.byok.config", "not json{{");
    expect(byokHeaders()).toEqual({});
  });
});

// Module-source guards (no top-level `window` access, no cross-file
// `sessionStorage` use) live in byokStorage-source-guard.test.ts — a plain
// node environment, since jsdom rewrites `import.meta.url` away from a real
// `file://` path (vitest.config.ts's `environmentOptions.jsdom.url`).
