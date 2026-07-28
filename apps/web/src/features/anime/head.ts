import { type JsonLdScriptTag, jsonLdScripts } from "../seo/json-ld";
import { DEFAULT_LOCALE, LOCALES, type Locale } from "../../i18n/locales";
import type { JsonLdNode } from "./structured-data";

/**
 * Head builder for `/anime/:id`: hreflang bootstrap + per-locale titles.
 *
 * SD-27C hard AC: each locale's `<title>` carries locale-native keyword sets
 * (ja 聖地巡礼/名場面, zh 打卡指南, en real-life locations) — not one keyword
 * set translated three ways — because AI answer engines have been observed to
 * ignore hreflang tags; localized keywords are the signal that works.
 */
export interface HreflangLink {
  readonly rel: "alternate";
  readonly hrefLang: string;
  readonly href: string;
}

const TITLE_BY_LOCALE: Record<Locale, (id: string) => string> = {
  ja: (id) => `聖地巡礼マップと名場面ランキング｜作品${id} | Animichi`,
  zh: (id) => `圣地巡礼地图与取景地打卡指南｜作品${id} | Animichi`,
  en: (id) => `Anime Pilgrimage Map & Real-Life Locations | Title ${id} | Animichi`,
};

function animeUrl(origin: string, bangumiId: string, locale: Locale): string {
  const path = `${origin}/anime/${bangumiId}`;
  return locale === DEFAULT_LOCALE ? path : `${path}?hl=${locale}`;
}

function alternate(hrefLang: string, href: string): HreflangLink {
  return { rel: "alternate", hrefLang, href };
}

export function animeAlternates(origin: string, bangumiId: string): HreflangLink[] {
  const links = LOCALES.map((locale) =>
    alternate(locale, animeUrl(origin, bangumiId, locale)),
  );
  return [...links, alternate("x-default", animeUrl(origin, bangumiId, DEFAULT_LOCALE))];
}

export function animeTitle(locale: Locale, bangumiId: string): string {
  return TITLE_BY_LOCALE[locale](bangumiId);
}

export interface AnimeHeadMeta {
  readonly title?: string;
  readonly name?: string;
  readonly content?: string;
}

export interface AnimeHead {
  meta: AnimeHeadMeta[];
  links: HreflangLink[];
  scripts: JsonLdScriptTag[];
}

export interface AnimeHeadOptions {
  readonly indexable: boolean;
  readonly jsonLd?: readonly JsonLdNode[];
}

/** Empty overviews are served but flagged noindex — no indexable soft-404s. */
function robotsMeta(options: AnimeHeadOptions): AnimeHeadMeta[] {
  return options.indexable ? [] : [{ name: "robots", content: "noindex" }];
}

const INDEXABLE: AnimeHeadOptions = { indexable: true };

export function animeHead(locale: Locale, bangumiId: string, origin: string, options: AnimeHeadOptions = INDEXABLE): AnimeHead {
  return {
    meta: [{ title: animeTitle(locale, bangumiId) }, ...robotsMeta(options)],
    links: animeAlternates(origin, bangumiId),
    scripts: jsonLdScripts(options.jsonLd ?? []),
  };
}
