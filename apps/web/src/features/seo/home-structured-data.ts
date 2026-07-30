import type { JsonLdNode } from "../anime/structured-data";
import { HOME_URL, LOGO_URL, SAME_AS, SITE_DESCRIPTION, SITE_NAME } from "./site";

/**
 * Home-page schema.org graph (SD-27C scope): `WebSite` + `Organization` only.
 *
 * `FAQPage` is deliberately absent — the port from `frontend/lib/structured-data.ts`
 * drops it, because rich results for FAQ have been discontinued for non-authoritative
 * sites and the markup is now pure payload. `BreadcrumbList` belongs to content
 * pages and already ships from `features/anime/structured-data.ts`.
 */
const SCHEMA = "https://schema.org";

function searchAction(): JsonLdNode {
  return {
    "@type": "SearchAction",
    target: { "@type": "EntryPoint", urlTemplate: `${HOME_URL}?q={search_term_string}` },
    "query-input": "required name=search_term_string",
  };
}

export function buildWebSite(): JsonLdNode {
  return {
    "@context": SCHEMA, "@type": "WebSite", "@id": HOME_URL, url: HOME_URL,
    name: SITE_NAME, description: SITE_DESCRIPTION, potentialAction: searchAction(),
  };
}

export function buildOrganization(): JsonLdNode {
  return {
    "@context": SCHEMA, "@type": "Organization", "@id": `${HOME_URL}#organization`,
    url: HOME_URL, name: SITE_NAME, logo: LOGO_URL, sameAs: SAME_AS,
  };
}

export function buildHomeJsonLd(): JsonLdNode[] {
  return [buildWebSite(), buildOrganization()];
}
