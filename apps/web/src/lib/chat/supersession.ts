/**
 * E1 living-document rule (spec-chat-page-states §E1): within one conversation,
 * only the newest card of a given document is current; every earlier card that
 * shares its document key dims to a "previous version". `supersededFlags` is
 * generic over the key so other living documents (issue #273 S1.7) reuse it by
 * supplying their own key producer — `routeDocumentKey` below is the route
 * card's (issue #271 S1.5), the first such producer.
 */
export function supersededFlags(keys: readonly (string | undefined)[]): readonly boolean[] {
  const lastIndex = new Map<string, number>();
  keys.forEach((key, index) => {
    if (key !== undefined) lastIndex.set(key, index);
  });
  return keys.map((key, index) => key !== undefined && lastIndex.get(key) !== index);
}

const ROUTE_INTENTS: ReadonlySet<string> = new Set([
  "plan_route",
  "plan_selected",
  "plan_multi",
  "partial",
]);

/** Intent discriminator of a streamed `data-response` payload (shared with
 * the E2 bypass detection in `selectedPointsBypass.ts` — one implementation). */
export function intentOf(data: unknown): string | undefined {
  if (typeof data !== "object" || data === null || !("intent" in data)) return undefined;
  const { intent } = data;
  return typeof intent === "string" ? intent : undefined;
}

/** Only frames that actually carry a route are versions of the document. */
function hasRoute(data: unknown): boolean {
  if (typeof data !== "object" || data === null || !("data" in data)) return false;
  const inner = data.data;
  if (typeof inner !== "object" || inner === null || !("route" in inner)) return false;
  return typeof inner.route === "object" && inner.route !== null && Object.keys(inner.route).length > 0;
}

/**
 * Document key for a streamed `data-response` payload: route-family cards that
 * carry a route form one living document per conversation. Intent-only frames
 * and non-route intents are keyless — they never dim, and never dim others.
 */
export function routeDocumentKey(data: unknown): string | undefined {
  const intent = intentOf(data);
  if (intent === undefined || !ROUTE_INTENTS.has(intent)) return undefined;
  return hasRoute(data) ? "route" : undefined;
}
