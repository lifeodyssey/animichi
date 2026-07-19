import { describe, expect, it } from "vitest";
import { animeAlternates, animeHead, animeTitle } from "../../../src/features/anime/head";

const ORIGIN = "https://animichi.example";

describe("animeAlternates", () => {
  it("emits one alternate link per locale plus x-default", () => {
    const links = animeAlternates(ORIGIN, "123");
    expect(links.map((link) => link.hrefLang)).toEqual(["ja", "zh", "en", "x-default"]);
  });

  it("builds absolute hrefs with the locale carried in the hl param", () => {
    const links = animeAlternates(ORIGIN, "123");
    expect(links[0]?.href).toBe("https://animichi.example/anime/123");
    expect(links[1]?.href).toBe("https://animichi.example/anime/123?hl=zh");
    expect(links[2]?.href).toBe("https://animichi.example/anime/123?hl=en");
    expect(links[3]?.href).toBe("https://animichi.example/anime/123");
  });

  it("marks every link as rel=alternate", () => {
    for (const link of animeAlternates(ORIGIN, "9")) {
      expect(link.rel).toBe("alternate");
    }
  });
});

describe("animeTitle", () => {
  it.each([
    ["ja", "聖地巡礼マップ"],
    ["zh", "圣地巡礼地图"],
    ["en", "Anime Pilgrimage Map"],
  ] as const)("localizes the %s title with locale-native keywords", (locale, keyword) => {
    expect(animeTitle(locale, "123")).toContain(keyword);
  });

  it("uses per-locale keyword sets, not one keyword set translated", () => {
    expect(animeTitle("ja", "1")).toContain("名場面ランキング");
    expect(animeTitle("zh", "1")).toContain("取景地打卡指南");
    expect(animeTitle("en", "1")).toContain("Real-Life Locations");
  });
});

describe("animeHead", () => {
  it("bundles the localized title and hreflang links for the route head", () => {
    const head = animeHead("zh", "123", ORIGIN);
    expect(head.meta.some((entry) => entry.title === animeTitle("zh", "123"))).toBe(true);
    expect(head.links).toHaveLength(4);
  });

  it("omits the robots meta for an indexable overview", () => {
    const head = animeHead("ja", "123", ORIGIN, { indexable: true });
    expect(head.meta.some((entry) => entry.name === "robots")).toBe(false);
  });

  it("adds robots noindex for a non-indexable empty overview", () => {
    const head = animeHead("ja", "999", ORIGIN, { indexable: false });
    expect(head.meta).toContainEqual({ name: "robots", content: "noindex" });
  });
});
