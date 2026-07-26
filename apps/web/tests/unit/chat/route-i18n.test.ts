import { describe, expect, it } from "vitest";
import { chatDictFor } from "../../../src/features/chat/i18n";
import { legCapsule, routeStatsCopy } from "../../../src/features/chat/route-copy";
import { LOCALES } from "../../../src/i18n/locales";

const PACINGS = ["chill", "normal", "packed"] as const;

describe("AC6: route dictionary coverage per locale", () => {
  it.each(LOCALES)("defines every pacing label and CTA string for %s", (locale) => {
    const route = chatDictFor(locale).route;
    for (const pacing of PACINGS) expect(route.pacing[pacing].length).toBeGreaterThan(0);
    for (const copy of [route.walkCta, route.openMaps, route.routePill, route.highlight]) {
      expect(copy.length).toBeGreaterThan(0);
    }
  });

  it("pins the ja pacing trio to the specced copy", () => {
    expect(chatDictFor("ja").route.pacing).toEqual({ chill: "ゆったり", normal: "適中", packed: "緊張" });
  });

  it("keeps each locale's pacing copy distinct from English", () => {
    expect(chatDictFor("ja").route.pacing.chill).not.toBe(chatDictFor("en").route.pacing.chill);
    expect(chatDictFor("zh").route.pacing.packed).not.toBe(chatDictFor("en").route.pacing.packed);
  });

  it.each(LOCALES)("localizes the E1 previous-version badge for %s", (locale) => {
    expect(chatDictFor(locale).previousVersion.length).toBeGreaterThan(0);
  });
});

describe("legCapsule templating", () => {
  it.each(LOCALES)("substitutes minutes into the %s walk and transit capsules", (locale) => {
    const dict = chatDictFor(locale);
    expect(legCapsule(dict, { mode: "walk", minutes: 12 })).toContain("12");
    expect(legCapsule(dict, { mode: "transit", minutes: 8 })).toContain("8");
    expect(legCapsule(dict, { mode: "walk", minutes: 12 })).not.toContain("{min}");
  });
});

// The card's headline was hardcoded English ("N spots · M min") and rendered
// that way to ja and zh users on the flagship deliverable of this story.
describe("route headline stats", () => {
  it("renders both numbers through localized copy in every locale", () => {
    const rendered = LOCALES.map((locale) => routeStatsCopy(chatDictFor(locale), 4, 25));
    for (const line of rendered) {
      expect(line).toContain("4");
      expect(line).toContain("25");
    }
    expect(new Set(rendered).size).toBe(LOCALES.length);
  });

  it("renders an em dash, not a bare question mark, when walking minutes are absent", () => {
    const line = routeStatsCopy(chatDictFor("ja"), 4, undefined);
    expect(line).toContain("—");
    expect(line).not.toContain("?");
  });
});
