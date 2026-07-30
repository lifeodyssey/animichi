import { describe, expect, it } from "vitest";
import { findHreflangDefects } from "../../../src/features/seo/hreflangGraph";
import { homeHead, SITE_META } from "../../../src/features/seo/head";
import {
  CANONICAL_ORIGIN,
  HOME_URL,
  SITE_DESCRIPTION,
  SITE_TITLE,
  homeAlternates,
} from "../../../src/features/seo/site";

function metaContent(name: string): string | undefined {
  return SITE_META.find((tag) => tag.property === name || tag.name === name)?.content;
}

/** SERP truncation is width-based: CJK renders fullwidth, ASCII halfwidth. */
function isFullwidth(codePoint: number): boolean {
  return (
    (codePoint >= 0x3000 && codePoint <= 0x9fff) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xff01 && codePoint <= 0xff60)
  );
}

function displayWidth(text: string): number {
  return Array.from(text).reduce((total, char) => total + (isFullwidth(char.codePointAt(0) ?? 0) ? 2 : 1), 0);
}

describe("canonical origin", () => {
  it("is the apex production domain, not a legacy or preview host", () => {
    expect(CANONICAL_ORIGIN).toBe("https://animichi.com");
    expect(HOME_URL).toBe("https://animichi.com/");
  });
});

describe("title and description budgets", () => {
  it("keeps the title inside the 50-60 display-width SERP budget", () => {
    expect(displayWidth(SITE_TITLE)).toBeGreaterThanOrEqual(50);
    expect(displayWidth(SITE_TITLE)).toBeLessThanOrEqual(60);
  });

  it("keeps the description inside the 120-160 display-width SERP budget", () => {
    expect(displayWidth(SITE_DESCRIPTION)).toBeGreaterThanOrEqual(120);
    expect(displayWidth(SITE_DESCRIPTION)).toBeLessThanOrEqual(160);
  });

  it("counts CJK as fullwidth and ASCII as halfwidth", () => {
    expect(displayWidth("聖地巡礼")).toBe(8);
    expect(displayWidth("Animichi")).toBe(8);
  });

  it("carries the locale-native pilgrimage keywords the SERP snippet needs", () => {
    for (const keyword of ["聖地巡礼", "アニメ", "ルート", "スポット"]) {
      expect(SITE_DESCRIPTION).toContain(keyword);
    }
  });
});

describe("SITE_META", () => {
  it("declares an og:website card on the canonical origin", () => {
    expect(metaContent("og:type")).toBe("website");
    expect(metaContent("og:url")).toBe(HOME_URL);
    expect(metaContent("og:site_name")).toBe("Animichi");
    expect(metaContent("og:locale")).toBe("ja_JP");
  });

  it("reuses the site title and description across og and twitter", () => {
    expect(metaContent("og:title")).toBe(SITE_TITLE);
    expect(metaContent("twitter:title")).toBe(SITE_TITLE);
    expect(metaContent("og:description")).toBe(SITE_DESCRIPTION);
    expect(metaContent("twitter:description")).toBe(SITE_DESCRIPTION);
  });

  it("ships an absolute 1200x630 image as a large summary card", () => {
    expect(metaContent("og:image")).toBe(`${CANONICAL_ORIGIN}/og-image.png`);
    expect(metaContent("og:image:width")).toBe("1200");
    expect(metaContent("og:image:height")).toBe("630");
    expect(metaContent("twitter:card")).toBe("summary_large_image");
    expect(metaContent("twitter:image")).toBe(`${CANONICAL_ORIGIN}/og-image.png`);
  });

  it("gives the OG image alt text so the card is not silently unlabelled", () => {
    expect(metaContent("og:image:alt")).toBeTruthy();
  });
});

describe("homeAlternates", () => {
  it("covers ja/zh/en plus x-default, all on the canonical origin", () => {
    expect(homeAlternates().map((link) => link.hrefLang)).toEqual(["ja", "zh", "en", "x-default"]);
    expect(homeAlternates().every((link) => link.href === HOME_URL)).toBe(true);
  });

  it("forms a closed hreflang graph", () => {
    expect(findHreflangDefects([{ url: HOME_URL, links: homeAlternates() }])).toEqual([]);
  });
});

describe("homeHead", () => {
  const head = homeHead();

  it("self-canonicalises the home page to the apex", () => {
    const canonical = head.links.find((link) => link.rel === "canonical");
    expect(canonical?.href).toBe(HOME_URL);
  });

  it("emits the hreflang alternates alongside the canonical", () => {
    const alternates = head.links.filter((link) => link.rel === "alternate");
    expect(alternates).toEqual(homeAlternates());
  });

  it("emits the home JSON-LD graph as one escaped ld+json script", () => {
    expect(head.scripts).toHaveLength(1);
    expect(head.scripts[0]?.type).toBe("application/ld+json");
    expect(head.scripts[0]?.children).not.toContain("<");
  });
});
