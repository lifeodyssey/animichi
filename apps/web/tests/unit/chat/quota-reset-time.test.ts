import { afterEach, describe, expect, it, vi } from "vitest";
import { quotaNotice } from "../../../src/features/chat/components/ErrorStates/QuotaExhausted";
import { chatDictFor } from "../../../src/features/chat/i18n";

const RESET_AT = Date.UTC(2026, 8, 12, 15);
afterEach(() => { vi.unstubAllEnvs(); });

describe("quota reset dates cross the reader's local midnight", () => {
  it.each([
    ["zh", "9月13日", "0:00"],
    ["ja", "9月13日", "0:00"],
    ["en", "Sep 13", "12:00 AM"],
  ] as const)("includes the next calendar day and midnight in %s", (locale, day, time) => {
    vi.stubEnv("TZ", "Asia/Tokyo");
    const text = quotaNotice(chatDictFor(locale), locale, RESET_AT);
    expect(text).toContain(day);
    expect(text).toContain(time);
    expect(text).not.toContain("{time}");
  });

  it("uses the same instant's earlier calendar day for a reader in Los Angeles", () => {
    vi.stubEnv("TZ", "America/Los_Angeles");
    const text = quotaNotice(chatDictFor("en"), "en", RESET_AT);
    expect(text).toContain("Sep 12");
    expect(text).toContain("8:00 AM");
  });
});

describe("unusable quota reset values", () => {
  it.each([undefined, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 1e16])("uses timeless guidance for %s", (value) => {
    const dict = chatDictFor("zh");
    expect(quotaNotice(dict, "zh", value)).toBe(dict.errorStates.d12Message);
  });
});
