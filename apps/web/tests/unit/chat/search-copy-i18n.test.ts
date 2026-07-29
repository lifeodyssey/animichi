import { describe, expect, it } from "vitest";
import { chatDictFor } from "../../../src/features/chat/i18n";
import { clusterName, episodeTag, spotCountBadge } from "../../../src/features/chat/search-copy";
import type { LocatedSpot, SpotCluster } from "../../../src/lib/chat/spotClusters";
import { LOCALES } from "../../../src/i18n/locales";

const CENTER = { lat: 34.89, lng: 135.8 };
const NO_SPOTS: readonly LocatedSpot[] = [];

function cluster(city?: string): SpotCluster {
  return { spots: NO_SPOTS, center: CENTER, city };
}

function searchValuesOf(locale: (typeof LOCALES)[number]): readonly string[] {
  const search = chatDictFor(locale).search;
  return [search.select, search.spotCount, search.areaFallback, search.mapLabel, search.backToOverview];
}

describe("cluster names across locales (AC: i18n)", () => {
  it.each(LOCALES)("passes the place name through untouched for %s", (locale) => {
    expect(clusterName(cluster("宇治市"), 0, chatDictFor(locale))).toBe("宇治市");
  });

  it("localizes the nameless-area fallback per locale", () => {
    expect(clusterName(cluster(), 0, chatDictFor("ja"))).toBe("エリア1");
    expect(clusterName(cluster(), 0, chatDictFor("zh"))).toBe("区域1");
    expect(clusterName(cluster(), 0, chatDictFor("en"))).toBe("Area 1");
  });

  it("numbers fallback areas from one, not zero", () => {
    expect(clusterName(cluster(), 2, chatDictFor("en"))).toBe("Area 3");
  });
});

describe("count badges across locales (AC: i18n)", () => {
  it("localizes the spot-count badge per locale", () => {
    expect(spotCountBadge(12, chatDictFor("ja"))).toBe("12件");
    expect(spotCountBadge(12, chatDictFor("zh"))).toBe("12 处");
    expect(spotCountBadge(12, chatDictFor("en"))).toBe("12 spots");
  });

  it("translates the C3b drill-back chip per locale (issue #437)", () => {
    const labels = LOCALES.map((locale) => chatDictFor(locale).search.backToOverview);
    expect(new Set(labels).size).toBe(LOCALES.length);
    expect(labels.every((label) => label.startsWith("←"))).toBe(true);
  });

  it.each(LOCALES)("keeps every %s search string non-empty", (locale) => {
    for (const value of searchValuesOf(locale)) {
      expect(value.length).toBeGreaterThan(0);
    }
  });
});

describe("episode tags", () => {
  it("localizes the episode tag via the shared d9 template", () => {
    expect(episodeTag(chatDictFor("ja"), 8)).toBe("第8話");
    expect(episodeTag(chatDictFor("en"), 8)).toBe("Ep. 8");
  });

  it("returns undefined when the episode is unknown", () => {
    expect(episodeTag(chatDictFor("ja"))).toBeUndefined();
  });
});
