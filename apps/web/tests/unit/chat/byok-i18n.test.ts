import { describe, expect, it } from "vitest";
import type { ChatByokDict } from "../../../src/features/chat/i18n";
import { chatDictFor } from "../../../src/features/chat/i18n";
import { LOCALES } from "../../../src/i18n/locales";

/** Every raw key name that must never leak into user-facing copy. */
const RAW_KEY_NAMES = [
  "X-BYOK-Provider",
  "X-BYOK-Key",
  "X-BYOK-Model",
  "X-BYOK-Base-Url",
  "byok_credential_rejected",
  "byok_requires_login",
  "invalid_request",
  "egress_blocked",
];

function allStrings(dict: ChatByokDict): readonly string[] {
  return [
    dict.title,
    dict.familyLabel,
    dict.familyOpenaiCompatible,
    dict.familyAnthropic,
    dict.familyGemini,
    dict.apiKeyLabel,
    dict.apiKeyRequired,
    dict.apiKeyInvalid,
    dict.modelLabel,
    dict.modelRequired,
    dict.baseUrlLabel,
    dict.baseUrlHelp,
    dict.baseUrlInvalid,
    dict.save,
    dict.clear,
    dict.maskedSummary,
    dict.visionBadge,
    dict.errorCredentialRejected,
    dict.errorRequiresLogin,
    dict.errorInvalidRequest,
    dict.errorEgressBlocked,
    dict.notAccepted,
    dict.anonymousTeaser,
    dict.signInToSetUp,
  ];
}

describe("BYOK panel copy (issue #284 Task 6)", () => {
  it.each(LOCALES)("resolves every key with non-empty copy for %s", (locale) => {
    for (const value of allStrings(chatDictFor(locale).byok)) {
      expect(value.length).toBeGreaterThan(0);
    }
  });

  it.each(LOCALES)("never leaks a raw header name or wire error code in %s copy", (locale) => {
    for (const value of allStrings(chatDictFor(locale).byok)) {
      for (const rawName of RAW_KEY_NAMES) {
        expect(value).not.toContain(rawName);
      }
    }
  });

});

describe("BYOK panel copy — field/message distinctness", () => {
  it("covers all three family selector labels distinctly per locale", () => {
    for (const locale of LOCALES) {
      const dict = chatDictFor(locale).byok;
      const labels = [dict.familyOpenaiCompatible, dict.familyAnthropic, dict.familyGemini];
      expect(new Set(labels).size).toBe(3);
    }
  });

  it("keeps the model-required validation message distinct from the label", () => {
    for (const locale of LOCALES) {
      const dict = chatDictFor(locale).byok;
      expect(dict.modelRequired).not.toBe(dict.modelLabel);
    }
  });

  it("keeps the key-required validation message distinct from the label", () => {
    for (const locale of LOCALES) {
      const dict = chatDictFor(locale).byok;
      expect(dict.apiKeyRequired).not.toBe(dict.apiKeyLabel);
    }
  });

  it("keeps the key-invalid message distinct from the key-required message", () => {
    for (const locale of LOCALES) {
      const dict = chatDictFor(locale).byok;
      expect(dict.apiKeyInvalid).not.toBe(dict.apiKeyRequired);
    }
  });

  it("provides distinct copy for every BYOK-specific error code across locales", () => {
    const ja = chatDictFor("ja").byok;
    const zh = chatDictFor("zh").byok;
    const en = chatDictFor("en").byok;
    expect(ja.errorCredentialRejected).not.toBe(en.errorCredentialRejected);
    expect(zh.errorCredentialRejected).not.toBe(en.errorCredentialRejected);
    expect(ja.errorRequiresLogin).not.toBe(en.errorRequiresLogin);
  });

  it("provides base_url helper copy distinct from its label", () => {
    for (const locale of LOCALES) {
      const dict = chatDictFor(locale).byok;
      expect(dict.baseUrlHelp).not.toBe(dict.baseUrlLabel);
    }
  });

  it("provides base_url-invalid copy distinct from its helper text", () => {
    for (const locale of LOCALES) {
      const dict = chatDictFor(locale).byok;
      expect(dict.baseUrlInvalid).not.toBe(dict.baseUrlHelp);
    }
  });
});
