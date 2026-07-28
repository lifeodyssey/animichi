/**
 * @vitest-environment jsdom
 *
 * validateByokConfig() rules: model requirement (OQ-1) and key requirement
 * (P1 review follow-up — Fable + Opus). Split out of byokStorage.test.ts to
 * keep each test file under the repo's ~200-line budget.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  BYOK_DEFAULT_MODEL,
  byokHeaders,
  clearByokConfig,
  getByokConfig,
  saveByokConfig,
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

describe("key requirement — every family (P1 review follow-up)", () => {
  it("rejects an empty or whitespace-only key regardless of family", () => {
    expect(validateByokConfig({ ...OPENAI_CONFIG, apiKey: "" })).toEqual({
      ok: false,
      error: "key_required",
    });
    expect(validateByokConfig({ ...ANTHROPIC_CONFIG, apiKey: "   " })).toEqual({
      ok: false,
      error: "key_required",
    });
  });

});

describe("key character safety — Headers()/fetch-breaking values (Opus P2①)", () => {
  it("rejects a key containing a newline as key_invalid, which would otherwise throw a generic TypeError from Headers()", () => {
    expect(validateByokConfig({ ...OPENAI_CONFIG, apiKey: "sk-abc\ninjected: x" })).toEqual({
      ok: false,
      error: "key_invalid",
    });
    expect(validateByokConfig({ ...OPENAI_CONFIG, apiKey: "sk-abc\r\ninjected" })).toEqual({
      ok: false,
      error: "key_invalid",
    });
  });

  it("rejects a key containing non-Latin-1 characters as key_invalid, which fetch would otherwise reject deep in the transport", () => {
    expect(validateByokConfig({ ...OPENAI_CONFIG, apiKey: "sk-abcéè" })).toEqual({
      ok: false,
      error: "key_invalid",
    });
    expect(validateByokConfig({ ...OPENAI_CONFIG, apiKey: "sk-😀-abc" })).toEqual({
      ok: false,
      error: "key_invalid",
    });
  });

  it("accepts a plain ASCII key with punctuation", () => {
    expect(validateByokConfig({ ...OPENAI_CONFIG, apiKey: "sk-Ab12_-.:" })).toEqual({ ok: true });
  });

  it("refuses to save (and does not touch storage, does not emit an empty X-BYOK-Key header) when the key is blank", () => {
    const result = saveByokConfig({ ...OPENAI_CONFIG, apiKey: "   " });
    expect(result).toEqual({ ok: false, error: "key_required" });
    expect(getByokConfig()).toBeNull();
    expect(byokHeaders()).toEqual({});
  });

  it("prioritizes key_required over model_required when both are invalid", () => {
    expect(validateByokConfig({ ...OPENAI_CONFIG, apiKey: "", model: "" })).toEqual({
      ok: false,
      error: "key_required",
    });
  });

  it("prioritizes key_invalid over model_required when both are invalid", () => {
    expect(validateByokConfig({ ...OPENAI_CONFIG, apiKey: "sk-abc\ninjected", model: "" })).toEqual({
      ok: false,
      error: "key_invalid",
    });
  });
});
