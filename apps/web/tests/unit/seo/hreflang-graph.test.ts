import { describe, expect, it } from "vitest";
import { animeAlternates } from "../../../src/features/anime/head";
import { findHreflangDefects, isHreflangClosed } from "../../../src/features/seo/hreflangGraph";

const ORIGIN = "https://animichi.example";

function animePage(id: string) {
  return { url: `${ORIGIN}/anime/${id}`, links: animeAlternates(ORIGIN, id) };
}

describe("isHreflangClosed", () => {
  it("passes when every anime page carries all locales plus x-default", () => {
    expect(isHreflangClosed([animePage("123"), animePage("456")])).toBe(true);
  });

  it("fails when a page is missing a language variant", () => {
    const broken = animePage("123");
    const links = broken.links.filter((link) => link.hrefLang !== "en");
    expect(isHreflangClosed([{ url: broken.url, links }])).toBe(false);
  });
});

describe("findHreflangDefects", () => {
  it("reports no defects for a closed trilingual graph", () => {
    expect(findHreflangDefects([animePage("123")])).toEqual([]);
  });

  it("flags a missing x-default fallback", () => {
    const page = animePage("123");
    const links = page.links.filter((link) => link.hrefLang !== "x-default");
    const defects = findHreflangDefects([{ url: page.url, links }]);
    expect(defects.some((defect) => defect.includes("x-default"))).toBe(true);
  });

  it("flags a non-reciprocal cross-link between two pages", () => {
    const good = animePage("123");
    const tampered = {
      url: `${ORIGIN}/anime/456`,
      links: good.links,
    };
    const defects = findHreflangDefects([good, tampered]);
    expect(defects.some((defect) => defect.includes("reciprocal"))).toBe(true);
  });
});
