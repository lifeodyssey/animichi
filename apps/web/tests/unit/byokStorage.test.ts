/**
 * @vitest-environment jsdom
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
  validateByokConfig,
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
});

describe("happy path (OQ-1) — model requirement by family", () => {
  it("requires a model for openai-compatible", () => {
    expect(validateByokConfig({ ...OPENAI_CONFIG, model: "" })).toEqual({
      ok: false,
      error: "model_required",
    });
    expect(validateByokConfig({ ...OPENAI_CONFIG, model: "   " })).toEqual({
      ok: false,
      error: "model_required",
    });
  });

  it("does not require a model for anthropic or gemini", () => {
    expect(validateByokConfig({ ...ANTHROPIC_CONFIG, model: "" })).toEqual({ ok: true });
    expect(validateByokConfig({ ...GEMINI_CONFIG, model: "" })).toEqual({ ok: true });
  });

  it("exposes a named default model constant for anthropic and gemini", () => {
    expect(BYOK_DEFAULT_MODEL.anthropic.length).toBeGreaterThan(0);
    expect(BYOK_DEFAULT_MODEL.gemini.length).toBeGreaterThan(0);
  });

  it("refuses to save (and does not touch storage) when the model is missing", () => {
    const result = saveByokConfig({ ...OPENAI_CONFIG, model: "" });
    expect(result).toEqual({ ok: false, error: "model_required" });
    expect(getByokConfig()).toBeNull();
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

// The module-source guards (no top-level `window` access, no other file
// touching `sessionStorage` for BYOK) live in byokStorage-source-guard.test.ts:
// under jsdom, `import.meta.url` resolves against the configured jsdom page
// URL rather than a real file:// path (see vitest.config.ts's
// environmentOptions.jsdom.url), so `node:fs` reads need the plain node
// environment instead.
