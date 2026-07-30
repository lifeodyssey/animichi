import type { HreflangLink } from "../anime/head";
import { LOCALES } from "../../i18n/locales";

/**
 * The single definition site for the production origin (SD-0: the apex is
 * canonical, `www` 301s onto it).
 *
 * It is a constant rather than a `VITE_*` read on purpose: `VITE_*` values are
 * inlined at build time and none are injected in this app's builds today
 * (#506), so an env-driven origin would silently resolve to `""` and ship
 * relative canonicals. `public/robots.txt` and `public/sitemap.xml` are copied
 * verbatim and cannot be templated at all, so the origin has to be a literal
 * somewhere; keeping exactly one literal — asserted by a test — makes a future
 * domain change a one-line edit.
 *
 * Preview/staging hosts serve this same production canonical, which is correct:
 * they are `noindex` behind Cloudflare Access, and a canonical pointing at the
 * real site is what we want any leaked crawl to consolidate onto.
 */
export const CANONICAL_ORIGIN = "https://animichi.com";
export const HOME_URL = `${CANONICAL_ORIGIN}/`;

export const SITE_NAME = "Animichi";
export const SITE_TITLE = "アニメ聖地巡礼 スポット検索・ルート計画 | Animichi";
export const SITE_DESCRIPTION =
  "アニメ聖地巡礼のスポット検索・ルート計画サービス。作品名から聖地巡礼の場所を探して、最適な巡礼ルートを自動生成。アニメの舞台を地図で確認しよう。";

export const OG_IMAGE_URL = `${CANONICAL_ORIGIN}/og-image.png`;
export const OG_IMAGE_ALT = "聖地巡礼マップ - アニメ聖地検索";
export const LOGO_URL = `${CANONICAL_ORIGIN}/images/logo/logo.png`;
export const ICON_PATH = "/images/logo/logo.svg";
export const APPLE_ICON_PATH = "/images/logo/logo.png";

/** Social profiles that resolve the Organization entity for knowledge panels. */
export const SAME_AS = ["https://github.com/lifeodyssey/animichi"] as const;

function alternate(hrefLang: string): HreflangLink {
  return { rel: "alternate", hrefLang, href: HOME_URL };
}

/**
 * The home page is one URL that picks its dictionary client-side, so every
 * locale — and `x-default` — maps onto that same URL.
 */
export function homeAlternates(): HreflangLink[] {
  return [...LOCALES.map((locale) => alternate(locale)), alternate("x-default")];
}
