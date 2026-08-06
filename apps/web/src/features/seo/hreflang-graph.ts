import type { HreflangLink } from "../anime/head";
import { LOCALES } from "../../i18n/locales";

/**
 * Site-wide hreflang closure verification (SD-27C).
 *
 * S5.1's bootstrap covers a single page's alternates; this closes the loop
 * across every programmatic page: each page must expose all locales plus
 * `x-default`, and every cross-link must be reciprocal (if page A points to
 * page B, B must point back at A). A defect list is returned rather than a
 * bare boolean so link-graph tests can assert *why* the loop is broken.
 */
export interface HreflangPage {
  readonly url: string;
  readonly links: readonly HreflangLink[];
}

const REQUIRED: readonly string[] = [...LOCALES, "x-default"];

function missingLangs(page: HreflangPage): string[] {
  const present = new Set(page.links.map((link) => link.hrefLang));
  return REQUIRED.filter((lang) => !present.has(lang));
}

function completenessDefects(page: HreflangPage): string[] {
  return missingLangs(page).map((lang) => `${page.url} missing ${lang} variant`);
}

function localeHrefs(page: HreflangPage): string[] {
  return page.links.filter((link) => link.hrefLang !== "x-default").map((link) => link.href);
}

function linksBack(target: HreflangPage, url: string): boolean {
  return localeHrefs(target).includes(url);
}

function brokenHref(page: HreflangPage, byUrl: Map<string, HreflangPage>, href: string): boolean {
  const target = byUrl.get(href);
  return target !== undefined && target.url !== page.url && !linksBack(target, page.url);
}

function reciprocityDefects(page: HreflangPage, byUrl: Map<string, HreflangPage>): string[] {
  return localeHrefs(page)
    .filter((href) => brokenHref(page, byUrl, href))
    .map((href) => `${page.url} not reciprocal with ${href}`);
}

export function findHreflangDefects(pages: readonly HreflangPage[]): string[] {
  const byUrl = new Map(pages.map((page) => [page.url, page] as const));
  return pages.flatMap((page) => [
    ...completenessDefects(page),
    ...reciprocityDefects(page, byUrl),
  ]);
}

export function isHreflangClosed(pages: readonly HreflangPage[]): boolean {
  return findHreflangDefects(pages).length === 0;
}
