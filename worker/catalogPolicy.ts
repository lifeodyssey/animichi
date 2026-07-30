export const CATALOG_OUTBOUND_ALLOWLIST = [
  "POST /catalog/search",
  "POST /catalog/resolve",
  "POST /catalog/points-by-work-id",
  "POST /catalog/spots",
  "POST /catalog/nearby",
  "POST /catalog/geocode",
  "POST /catalog/route",
  "POST /catalog/ingest",
] as const;

const CATALOG_OUTBOUND_ROUTES = new Set<string>(CATALOG_OUTBOUND_ALLOWLIST);

export function catalogRequestAllowed(request: Request): boolean {
  const pathname = new URL(request.url).pathname;
  return CATALOG_OUTBOUND_ROUTES.has(`${request.method} ${pathname}`);
}
