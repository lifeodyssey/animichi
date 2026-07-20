import { describe, expect, it } from "vitest";
import { LOCALES } from "../../../src/i18n/locales";
import { bubbleMapCopyFor } from "../../../src/features/bubble-map/copy";

describe("bubbleMapCopyFor", () => {
  it("provides copy for every supported locale", () => {
    for (const locale of LOCALES) {
      const copy = bubbleMapCopyFor(locale);
      expect(copy.heading.length).toBeGreaterThan(0);
      expect(copy.empty.length).toBeGreaterThan(0);
      expect(copy.close.length).toBeGreaterThan(0);
    }
  });

  it("interpolates the region and counts for every locale's formatters", () => {
    for (const locale of LOCALES) {
      const copy = bubbleMapCopyFor(locale);
      expect(copy.sheetTitle("Tokyo")).toContain("Tokyo");
      expect(copy.spotUnit(3)).toContain("3");
      expect(copy.shotCount(7)).toContain("7");
    }
  });
});
