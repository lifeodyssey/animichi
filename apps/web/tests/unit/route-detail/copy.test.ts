import { describe, expect, it } from "vitest";
import { routeDetailCopyFor } from "../../../src/lib/route-detail/copy";
import { LOCALES } from "../../../src/i18n/locales";

describe("routeDetailCopyFor", () => {
  it.each(LOCALES)("provides a non-empty gold-bar and error copy for %s", (locale) => {
    const copy = routeDetailCopyFor(locale);
    expect(copy.goldBar.length).toBeGreaterThan(0);
    expect(copy.errorTitle.length).toBeGreaterThan(0);
  });

  it.each(LOCALES)("renders the 完走 badge label with done/total counts for %s", (locale) => {
    expect(routeDetailCopyFor(locale).completedBadge(5, 5)).toContain("5/5");
    expect(routeDetailCopyFor(locale).completedBadge(3, 4)).toContain("3/4");
  });

  it("keeps the today gold-bar copy distinct per locale", () => {
    expect(routeDetailCopyFor("ja").goldBar).toContain("巡礼日");
    expect(routeDetailCopyFor("zh").goldBar).not.toBe(routeDetailCopyFor("en").goldBar);
  });
});
