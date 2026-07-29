import { describe, expect, it } from "vitest";
import type { JsonLdNode } from "../../../src/features/anime/structured-data";
import { jsonLdScripts, serializeJsonLd } from "../../../src/features/seo/json-ld";

const NODES: JsonLdNode[] = [
  { "@context": "https://schema.org", "@type": "CreativeWork", "@id": "https://x/anime/1" },
  { "@context": "https://schema.org", "@type": "BreadcrumbList" },
];

describe("jsonLdScripts", () => {
  it("serializes the node graph into one application/ld+json script tag", () => {
    const scripts = jsonLdScripts(NODES);
    expect(scripts).toHaveLength(1);
    expect(scripts[0]?.type).toBe("application/ld+json");
    const parsed = JSON.parse(scripts[0]?.children ?? "") as JsonLdNode[];
    expect(parsed.map((node) => node["@type"])).toEqual(["CreativeWork", "BreadcrumbList"]);
  });

  it("emits no script tag for an empty node graph", () => {
    expect(jsonLdScripts([])).toEqual([]);
  });
});

describe("serializeJsonLd", () => {
  it("escapes angle brackets to prevent script-tag breakout", () => {
    const json = serializeJsonLd([{ "@type": "Thing", name: "a</script><b" }]);
    expect(json).not.toContain("<");
    expect(json).toContain("\\u003c/script>");
    expect(JSON.parse(json)).toEqual([{ "@type": "Thing", name: "a</script><b" }]);
  });
});
