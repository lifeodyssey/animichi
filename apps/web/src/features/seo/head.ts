import { type JsonLdScriptTag, jsonLdScripts } from "./json-ld";
import { buildHomeJsonLd } from "./home-structured-data";
import {
  APPLE_ICON_PATH,
  HOME_URL,
  ICON_PATH,
  OG_IMAGE_ALT,
  OG_IMAGE_URL,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_TITLE,
  homeAlternates,
} from "./site";

/**
 * Site-wide head fragments, spread into the root route (`SITE_META`,
 * `SITE_ICON_LINKS`) and the home route (`homeHead`).
 *
 * Open Graph uses `property`, Twitter uses `name` — they are different
 * vocabularies and collapsing them onto one attribute silently drops the card.
 */
export interface SeoMetaTag {
  readonly name?: string;
  readonly property?: string;
  readonly content: string;
}

export interface HeadLink {
  readonly rel: string;
  readonly href: string;
  readonly hrefLang?: string;
  readonly type?: string;
}

export const SITE_META: readonly SeoMetaTag[] = [
  { property: "og:type", content: "website" },
  { property: "og:url", content: HOME_URL },
  { property: "og:site_name", content: SITE_NAME },
  { property: "og:locale", content: "ja_JP" },
  { property: "og:title", content: SITE_TITLE },
  { property: "og:description", content: SITE_DESCRIPTION },
  { property: "og:image", content: OG_IMAGE_URL },
  { property: "og:image:width", content: "1200" },
  { property: "og:image:height", content: "630" },
  { property: "og:image:alt", content: OG_IMAGE_ALT },
  { name: "twitter:card", content: "summary_large_image" },
  { name: "twitter:title", content: SITE_TITLE },
  { name: "twitter:description", content: SITE_DESCRIPTION },
  { name: "twitter:image", content: OG_IMAGE_URL },
];

export const SITE_ICON_LINKS: readonly HeadLink[] = [
  { rel: "icon", href: ICON_PATH, type: "image/svg+xml" },
  { rel: "apple-touch-icon", href: APPLE_ICON_PATH },
];

export interface HomeHead {
  readonly links: HeadLink[];
  readonly scripts: JsonLdScriptTag[];
}

export function homeHead(): HomeHead {
  return {
    links: [{ rel: "canonical", href: HOME_URL }, ...homeAlternates()],
    scripts: jsonLdScripts(buildHomeJsonLd()),
  };
}
