import type { JsonLdNode } from "../anime/structured-data";

/**
 * SSR-visible schema.org injector: one `application/ld+json` script per page.
 *
 * `<` is escaped to `<` so a `</script>` sequence inside any string value
 * can never break out of the tag; `dangerouslySetInnerHTML` keeps the JSON
 * bytes verbatim (React would otherwise HTML-escape `&` in query strings).
 */
type Props = Readonly<{ nodes: readonly JsonLdNode[] }>;

function serialize(nodes: readonly JsonLdNode[]): string {
  return JSON.stringify(nodes).replace(/</g, "\\u003c");
}

export function JsonLd({ nodes }: Props) {
  if (nodes.length === 0) return null;
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: serialize(nodes) }}
    />
  );
}
