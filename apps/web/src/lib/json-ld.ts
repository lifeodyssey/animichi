/**
 * SSR-visible schema.org injection, expressed as router head script tags:
 * routes return these from `head()` (→ `scripts`) and TanStack's
 * `<HeadContent />` renders them — no `dangerouslySetInnerHTML` in app code.
 *
 * Every `<` is escaped to its unicode form (u003c) so a closing-script-tag
 * sequence inside any string value can never break out of the tag.
 *
 * This module owns the JSON-LD node types and the serializer only; per-page
 * builders live in their features (`features/anime/structured-data.ts`,
 * `features/seo/home-structured-data.ts`). It is the shared home that keeps
 * the anime and seo features from importing each other (issue #1009 AC1).
 */

/** A recursive JSON-LD value: scalars, nodes, or arrays thereof. */
export type JsonLdValue = string | number | boolean | null | JsonLdNode | readonly JsonLdValue[];
export interface JsonLdNode {
  readonly [key: string]: JsonLdValue;
}

export interface JsonLdScriptTag {
  readonly type: "application/ld+json";
  readonly children: string;
}

export function serializeJsonLd(nodes: readonly JsonLdNode[]): string {
  return JSON.stringify(nodes).replace(/</g, "\\u003c");
}

export function jsonLdScripts(nodes: readonly JsonLdNode[]): JsonLdScriptTag[] {
  if (nodes.length === 0) return [];
  return [{ type: "application/ld+json", children: serializeJsonLd(nodes) }];
}
