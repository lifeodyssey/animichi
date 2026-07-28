/**
 * @vitest-environment jsdom
 *
 * `HEADER_SAFE` character-safety extended to the model field (every family,
 * not just openai-compatible) and to base_url (Opus P2① follow-up, second
 * round). Split out of byokStorage-validation.test.ts to keep each file
 * under the repo's ~200-line budget.
 *
 * Five probes, per review: a Japanese model name on anthropic/gemini, a
 * CRLF-injected model, an internationalized-domain base_url, a CRLF in
 * base_url, and a regression confirming a plain ASCII base_url still saves.
 * Each of these previously saved successfully and only crashed
 * `Headers()`/`fetch()` later, at turn time, exactly the failure shape
 * `keyInvalid` already guards the key field against.
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

afterEach(() => {
  clearByokConfig();
});

describe("model character safety — every family (probes 1-2)", () => {
  it("probe 1: rejects a Japanese model name on anthropic as model_required", () => {
    expect(validateByokConfig({ ...ANTHROPIC_CONFIG, model: "クロード・ソネット" })).toEqual({
      ok: false,
      error: "model_required",
    });
  });

  it("probe 2: rejects a CRLF-injected model name on gemini as model_required", () => {
    expect(
      validateByokConfig({ ...ANTHROPIC_CONFIG, provider: "gemini", model: "gemini-2.5\r\nX-Injected: x" }),
    ).toEqual({ ok: false, error: "model_required" });
  });

  it("still accepts the named default model for anthropic/gemini (regression)", () => {
    expect(validateByokConfig(ANTHROPIC_CONFIG)).toEqual({ ok: true });
  });

  it("refuses to save (and does not touch storage) an unsafe model on a non-openai-compatible family", () => {
    const result = saveByokConfig({ ...ANTHROPIC_CONFIG, model: "日本語モデル" });
    expect(result).toEqual({ ok: false, error: "model_required" });
    expect(getByokConfig()).toBeNull();
  });
});

describe("base_url character safety — openai-compatible only (probes 3-4)", () => {
  it("probe 3: rejects an internationalized-domain base_url as base_url_invalid", () => {
    // Deliberately not punycode-decoded here — see the module doc comment.
    // The settings panel is expected to prompt for an ASCII/A-label host.
    expect(validateByokConfig({ ...OPENAI_CONFIG, baseUrl: "https://例え.jp/v1" })).toEqual({
      ok: false,
      error: "base_url_invalid",
    });
  });

  it("probe 4: rejects a CRLF-injected base_url as base_url_invalid", () => {
    expect(validateByokConfig({ ...OPENAI_CONFIG, baseUrl: "https://api.example.com\r\nX-Injected: x" })).toEqual({
      ok: false,
      error: "base_url_invalid",
    });
  });

  it("probe 5 (regression): still accepts a plain ASCII base_url", () => {
    expect(validateByokConfig(OPENAI_CONFIG)).toEqual({ ok: true });
  });

  it("does not check base_url character safety for anthropic/gemini (the field is unused there)", () => {
    expect(validateByokConfig({ ...ANTHROPIC_CONFIG, baseUrl: "not a url at all\r\n" })).toEqual({ ok: true });
  });

  it("refuses to save (and does not emit the header) an unsafe base_url", () => {
    const result = saveByokConfig({ ...OPENAI_CONFIG, baseUrl: "https://例え.jp/v1" });
    expect(result).toEqual({ ok: false, error: "base_url_invalid" });
    expect(getByokConfig()).toBeNull();
    expect(byokHeaders()).toEqual({});
  });
});
