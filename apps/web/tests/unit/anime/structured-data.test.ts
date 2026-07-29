import { describe, expect, it } from "vitest";
import type { JsonLdNode } from "../../../src/features/anime/structured-data";
import {
  buildAnimeJsonLd,
  buildBreadcrumb,
  buildSceneImages,
} from "../../../src/features/anime/structured-data";
import { emptyOverviewFixture, fullOverviewFixture } from "../../msw/anime-overview";

const ORIGIN = "https://animichi.example";

function nodeOfType(nodes: readonly JsonLdNode[], type: string): JsonLdNode {
  const node = nodes.find((entry) => entry["@type"] === type);
  if (!node) throw new Error(`missing ${type}`);
  return node;
}

describe("buildAnimeJsonLd main entity", () => {
  it("types the work as CreativeWork with a canonical @id and locale", () => {
    const work = nodeOfType(buildAnimeJsonLd(fullOverviewFixture, "en", ORIGIN), "CreativeWork");
    expect(work["@context"]).toBe("https://schema.org");
    expect(work["@id"]).toBe("https://animichi.example/anime/123");
    expect(work.inLanguage).toBe("en");
  });

  it("carries per-anime unique field values, not a title-swapped template", () => {
    const work = nodeOfType(buildAnimeJsonLd(fullOverviewFixture, "ja", ORIGIN), "CreativeWork");
    const props = work.additionalProperty as JsonLdNode[];
    const spots = props.find((p) => p.name === "pilgrimageSpotCount");
    const regions = props.find((p) => p.name === "topRegions");
    expect(spots?.value).toBe(6);
    expect(regions?.value).toContain("Takayama");
  });
});

describe("buildBreadcrumb", () => {
  it("renders a Home > work BreadcrumbList with sequential positions", () => {
    const crumb = buildBreadcrumb(fullOverviewFixture, "en", ORIGIN);
    const items = crumb.itemListElement as JsonLdNode[];
    expect(crumb["@type"]).toBe("BreadcrumbList");
    expect(items.map((i) => i.position)).toEqual([1, 2]);
    expect(items[0]?.item).toBe("https://animichi.example/");
  });

  it("excludes scene anchors from the breadcrumb item urls", () => {
    const crumb = buildBreadcrumb(fullOverviewFixture, "ja", ORIGIN);
    const items = crumb.itemListElement as { readonly item: string }[];
    for (const item of items) expect(item.item).not.toContain("#");
  });
});

describe("buildSceneImages", () => {
  it("emits a licensed ImageObject per scene screenshot with attribution", () => {
    const images = buildSceneImages(fullOverviewFixture);
    expect(images).toHaveLength(2);
    expect(images[0]?.["@type"]).toBe("ImageObject");
    expect(images[0]?.license).toBe("https://creativecommons.org/licenses/by-nc-sa/4.0/");
    expect(images[0]?.creditText).toBe("Anitabi");
    expect(images[0]?.contentUrl).toBe("https://cdn.test/scene-2.jpg");
  });

  it("skips scenes without a screenshot url", () => {
    const scenes = fullOverviewFixture.scenes.map((scene) => ({ ...scene, screenshot_url: null }));
    expect(buildSceneImages({ ...fullOverviewFixture, scenes })).toHaveLength(0);
  });
});

describe("buildAnimeJsonLd empty state", () => {
  it("still returns valid CreativeWork + BreadcrumbList for a zero-spot work", () => {
    const nodes = buildAnimeJsonLd(emptyOverviewFixture("404404"), "ja", ORIGIN);
    expect(nodeOfType(nodes, "CreativeWork")["@id"]).toBe("https://animichi.example/anime/404404");
    expect(nodeOfType(nodes, "BreadcrumbList")).toBeTruthy();
    expect(nodes.some((n) => n["@type"] === "ImageObject")).toBe(false);
  });
});
