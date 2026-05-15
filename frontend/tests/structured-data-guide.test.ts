import { describe, it, expect } from "vitest";
import { buildBreadcrumbJsonLd, buildAnimeGuideJsonLd } from "../lib/structured-data-guide";
import type { AnimeGuideResponse } from "../lib/api/guide";
import type { PilgrimagePoint } from "../lib/types/domain";

function makeSpot(overrides: Partial<PilgrimagePoint> = {}): PilgrimagePoint {
  return {
    id: "sp-1",
    name: "Spot A",
    name_cn: null,
    episode: 1,
    time_seconds: null,
    screenshot_url: "https://img.example.com/a.jpg",
    bangumi_id: "123",
    latitude: 35.0,
    longitude: 139.0,
    ...overrides,
  };
}

function makeGuide(overrides: Partial<AnimeGuideResponse> = {}): AnimeGuideResponse {
  return {
    bangumi_id: "123",
    title: "Yuru Camp",
    title_cn: "摇曳露营",
    cover_url: "https://img.example.com/cover.jpg",
    city: "Yamanashi",
    spot_count: 2,
    spots: [makeSpot(), makeSpot({ id: "sp-2", name: "Spot B" })],
    bounds: null,
    ...overrides,
  };
}

describe("buildBreadcrumbJsonLd", () => {
  it("returns BreadcrumbList with 3 items", () => {
    const result = buildBreadcrumbJsonLd("Yuru Camp", "123");
    expect(result["@type"]).toBe("BreadcrumbList");
    expect(result.itemListElement).toHaveLength(3);
    expect(result.itemListElement[0].position).toBe(1);
    expect(result.itemListElement[1].position).toBe(2);
    expect(result.itemListElement[2].position).toBe(3);
  });

  it("generates correct URLs for each breadcrumb", () => {
    const result = buildBreadcrumbJsonLd("Yuru Camp", "456");
    const items = result.itemListElement;
    expect(items[0].item).toBe("https://seichijunrei.zhenjia.org");
    expect(items[1].item).toBe("https://seichijunrei.zhenjia.org/anime");
    expect(items[2].item).toBe("https://seichijunrei.zhenjia.org/anime/456");
  });
});

describe("buildAnimeGuideJsonLd", () => {
  it("returns CreativeWork with correct fields", () => {
    const result = buildAnimeGuideJsonLd(makeGuide());
    expect(result["@type"]).toBe("CreativeWork");
    expect(result.name).toBe("Yuru Camp");
    expect(result.url).toBe("https://seichijunrei.zhenjia.org/anime/123");
    expect(result.description).toBe("2 pilgrimage spots");
    expect(result.image).toBe("https://img.example.com/cover.jpg");
  });

  it("omits image when cover_url is null", () => {
    const result = buildAnimeGuideJsonLd(makeGuide({ cover_url: null }));
    expect(result).not.toHaveProperty("image");
  });

  it("returns empty containsPlace when spots is empty", () => {
    const result = buildAnimeGuideJsonLd(makeGuide({ spots: [], spot_count: 0 }));
    expect(result.containsPlace).toEqual([]);
    expect(result.description).toBe("0 pilgrimage spots");
  });

  it("omits locationCreated when city is null", () => {
    const result = buildAnimeGuideJsonLd(makeGuide({ city: null }));
    expect(result).not.toHaveProperty("locationCreated");
  });

  it("limits containsPlace to first 10 spots", () => {
    const spots = Array.from({ length: 15 }, (_, i) =>
      makeSpot({ id: `sp-${i}`, name: `Spot ${i}` }),
    );
    const result = buildAnimeGuideJsonLd(makeGuide({ spots, spot_count: 15 }));
    expect(result.containsPlace).toHaveLength(10);
  });

  it("includes alternateName when title_cn exists", () => {
    const result = buildAnimeGuideJsonLd(makeGuide({ title_cn: "摇曳露营" }));
    expect(result.alternateName).toBe("摇曳露营");
  });

  it("omits alternateName when title_cn is null", () => {
    const result = buildAnimeGuideJsonLd(makeGuide({ title_cn: null }));
    expect(result).not.toHaveProperty("alternateName");
  });

  it("includes geo coordinates and image in spot places", () => {
    const result = buildAnimeGuideJsonLd(makeGuide());
    const place = result.containsPlace[0];
    expect(place["@type"]).toBe("TouristAttraction");
    expect(place.geo.latitude).toBe(35.0);
    expect(place.geo.longitude).toBe(139.0);
    expect(place.image).toBe("https://img.example.com/a.jpg");
  });
});
