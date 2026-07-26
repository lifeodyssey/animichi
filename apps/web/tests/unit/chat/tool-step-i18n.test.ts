import { describe, expect, it } from "vitest";
import {
  HIDDEN_TOOL_STEPS,
  TOOL_STEP_KEYS,
  chatDictFor,
  toolStepLabel,
} from "../../../src/features/chat/i18n";
import { LOCALES } from "../../../src/i18n/locales";

const JAPANESE_SCRIPT = /[぀-ヿ一-鿿]/u;

describe("tool-step dictionary coverage", () => {
  it.each(LOCALES)("has non-empty %s copy for every tool key and the fallback", (locale) => {
    const steps = chatDictFor(locale).toolSteps;
    for (const key of TOOL_STEP_KEYS) {
      expect(steps.labels[key].length, `${locale} toolSteps.labels.${key}`).toBeGreaterThan(0);
    }
    expect(steps.fallback.length).toBeGreaterThan(0);
  });

  it("writes the ja step copy in Japanese so a ja user never sees leaked English", () => {
    const steps = chatDictFor("ja").toolSteps;
    for (const key of TOOL_STEP_KEYS) {
      expect(JAPANESE_SCRIPT.test(steps.labels[key]), `ja toolSteps.labels.${key}`).toBe(true);
    }
    expect(JAPANESE_SCRIPT.test(steps.fallback)).toBe(true);
  });

  it.each(LOCALES)("keeps raw snake_case identifiers out of every %s label", (locale) => {
    const steps = chatDictFor(locale).toolSteps;
    for (const key of TOOL_STEP_KEYS) {
      expect(steps.labels[key], `${locale} toolSteps.labels.${key}`).not.toContain("_");
    }
    expect(steps.fallback).not.toContain("_");
  });
});

describe("toolStepLabel", () => {
  it("returns the mapped label for a known tool", () => {
    const dict = chatDictFor("en");
    expect(toolStepLabel(dict, "web_search")).toBe(dict.toolSteps.labels.web_search);
  });

  it("returns the fallback for an unknown tool", () => {
    const dict = chatDictFor("en");
    expect(toolStepLabel(dict, "never_registered")).toBe(dict.toolSteps.fallback);
  });
});

describe("hidden tool list", () => {
  it("hides translate_anime_title and never a surfaced tool", () => {
    expect(HIDDEN_TOOL_STEPS.has("translate_anime_title")).toBe(true);
    for (const key of TOOL_STEP_KEYS) {
      expect(HIDDEN_TOOL_STEPS.has(key), `surfaced tool ${key} must not be hidden`).toBe(false);
    }
  });
});
