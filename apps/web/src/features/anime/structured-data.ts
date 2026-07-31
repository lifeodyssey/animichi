import type { AnimeOverview, AnimeScene } from "@animichi/contract";
import type { Locale } from "../../i18n/locales";
import { animeTitle } from "./head";

/**
 * schema.org JSON-LD builders for `/anime/:id` (SD-27 contracted mapping).
 *
 * Every value is derived from `AnimeOverview` alone — the public catalog
 * contract carries no title/eps/datePublished, so the graph stays honest:
 * a `CreativeWork` whose `additionalProperty` set encodes this work's unique
 * spot/region/scene counts (SD-27C "one entity, one page + unique data"),
 * a `BreadcrumbList`, and one licensed `ImageObject` per famous-scene frame.
 */
export type JsonLdValue = string | number | boolean | null | JsonLdNode | readonly JsonLdValue[];
export interface JsonLdNode {
  readonly [key: string]: JsonLdValue;
}

const SCHEMA = "https://schema.org";
const LICENSE = "https://creativecommons.org/licenses/by-nc-sa/4.0/";
const CREDIT = "Anitabi";
const HOME_LABEL: Record<Locale, string> = { ja: "ホーム", zh: "首页", en: "Home" };
const WORK_LABEL: Record<Locale, string> = { ja: "作品", zh: "作品", en: "Anime" };

function canonicalUrl(origin: string, bangumiId: string): string {
  return `${origin}/anime/${bangumiId}`;
}

function propertyValue(name: string, value: number | string): JsonLdNode {
  return { "@type": "PropertyValue", name, value };
}

function uniqueFacts(overview: AnimeOverview): JsonLdNode[] {
  return [
    propertyValue("pilgrimageSpotCount", overview.points_length),
    propertyValue("regionCount", overview.circles.length),
    propertyValue("famousSceneCount", overview.scenes.length),
    propertyValue("topRegions", overview.circles.map((circle) => circle.region).join(", ")),
  ];
}

function buildCreativeWork(overview: AnimeOverview, locale: Locale, origin: string): JsonLdNode {
  const url = canonicalUrl(origin, overview.bangumi_id);
  return {
    "@context": SCHEMA, "@type": "CreativeWork", "@id": url, url,
    inLanguage: locale, name: animeTitle(locale, overview.bangumi_id),
    additionalProperty: uniqueFacts(overview),
  };
}

function listItem(position: number, name: string, item: string): JsonLdNode {
  return { "@type": "ListItem", position, name, item };
}

export function buildBreadcrumb(overview: AnimeOverview, locale: Locale, origin: string): JsonLdNode {
  return {
    "@context": SCHEMA,
    "@type": "BreadcrumbList",
    itemListElement: [
      listItem(1, HOME_LABEL[locale], `${origin}/`),
      listItem(2, WORK_LABEL[locale], canonicalUrl(origin, overview.bangumi_id)),
    ],
  };
}

function sceneImage(scene: AnimeScene): JsonLdNode | null {
  if (scene.screenshot_url === null) return null;
  return {
    "@type": "ImageObject", "@id": scene.screenshot_url, contentUrl: scene.screenshot_url,
    name: scene.name, license: LICENSE, creditText: CREDIT,
  };
}

export function buildSceneImages(overview: AnimeOverview): JsonLdNode[] {
  return overview.scenes
    .map(sceneImage)
    .filter((node): node is JsonLdNode => node !== null);
}

export function buildAnimeJsonLd(overview: AnimeOverview, locale: Locale, origin: string): JsonLdNode[] {
  return [
    buildCreativeWork(overview, locale, origin),
    buildBreadcrumb(overview, locale, origin),
    ...buildSceneImages(overview),
  ];
}
