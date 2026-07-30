import { describe, expect, it } from "vitest";
import type { JsonLdNode } from "../../../src/features/anime/structured-data";
import { buildHomeJsonLd } from "../../../src/features/seo/home-structured-data";
import { CANONICAL_ORIGIN, HOME_URL } from "../../../src/features/seo/site";

const GRAPH = buildHomeJsonLd();

function node(type: string): JsonLdNode {
  const found = GRAPH.find((candidate) => candidate["@type"] === type);
  if (!found) throw new Error(`no ${type} node in the home JSON-LD graph`);
  return found;
}

describe("buildHomeJsonLd", () => {
  it("ships exactly the WebSite + Organization pair (SD-27C drops FAQPage)", () => {
    expect(GRAPH.map((entry) => entry["@type"])).toEqual(["WebSite", "Organization"]);
  });

  it("anchors every node to schema.org and the canonical home URL", () => {
    for (const entry of GRAPH) {
      expect(entry["@context"]).toBe("https://schema.org");
      expect(entry.url).toBe(HOME_URL);
    }
  });
});

describe("WebSite node", () => {
  const website = node("WebSite");

  it("names the site", () => {
    expect(website.name).toBe("Animichi");
  });

  it("exposes a SearchAction whose target templates the query parameter", () => {
    const action = website.potentialAction as JsonLdNode;
    expect(action["@type"]).toBe("SearchAction");
    expect((action.target as JsonLdNode).urlTemplate).toBe(`${HOME_URL}?q={search_term_string}`);
    expect(action["query-input"]).toBe("required name=search_term_string");
  });
});

describe("Organization node", () => {
  const organization = node("Organization");

  it("carries the brand logo on the canonical origin", () => {
    expect(organization.name).toBe("Animichi");
    expect(organization.logo).toBe(`${CANONICAL_ORIGIN}/images/logo/logo.png`);
  });

  it("anchors sameAs to a real social profile so the entity is resolvable", () => {
    expect(organization.sameAs).toEqual(["https://github.com/lifeodyssey/animichi"]);
  });
});
