/**
 * @vitest-environment jsdom
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { JsonLdNode } from "../../../src/features/anime/structured-data";
import { JsonLd } from "../../../src/features/seo/JsonLd";

afterEach(cleanup);

const NODES: JsonLdNode[] = [
  { "@context": "https://schema.org", "@type": "CreativeWork", "@id": "https://x/anime/1" },
  { "@context": "https://schema.org", "@type": "BreadcrumbList" },
];

function scriptEl(container: HTMLElement): HTMLScriptElement {
  const el = container.querySelector('script[type="application/ld+json"]');
  if (!el) throw new Error("no json-ld script");
  return el as HTMLScriptElement;
}

describe("JsonLd", () => {
  it("serializes the node graph into an application/ld+json script", () => {
    const { container } = render(<JsonLd nodes={NODES} />);
    const parsed = JSON.parse(scriptEl(container).innerHTML) as JsonLdNode[];
    expect(parsed).toHaveLength(2);
    expect(parsed.map((node) => node["@type"])).toContain("CreativeWork");
  });

  it("escapes angle brackets to prevent script-tag breakout", () => {
    const { container } = render(<JsonLd nodes={[{ "@type": "Thing", name: "a<b" }]} />);
    expect(scriptEl(container).innerHTML).not.toContain("<b");
    expect(scriptEl(container).innerHTML).toContain("\\u003c");
  });

  it("renders nothing when the node graph is empty", () => {
    const { container } = render(<JsonLd nodes={[]} />);
    expect(container.querySelector("script")).toBeNull();
  });
});
