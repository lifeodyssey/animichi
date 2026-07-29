import type { JsonLdNode } from "../anime/structured-data";

/**
 * SSR-visible schema.org injection, expressed as router head script tags:
 * routes return these from `head()` (→ `scripts`) and TanStack's
 * `<HeadContent />` renders them — no `dangerouslySetInnerHTML` in app code.
 *
 * Every `<` is escaped to its unicode form (u003c) so a closing-script-tag
 * sequence inside any string value can never break out of the tag.
 */
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
