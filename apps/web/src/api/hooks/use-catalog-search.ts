import { useQuery } from "@tanstack/react-query";
import type { SearchInput } from "@animichi/contract";
import { catalog } from "../orpc";

/**
 * Query the catalog for pilgrimage points matching an anime title.
 *
 * Disabled on an empty query so the results view can render before the user
 * types. The query key is prefixed with `["catalog", "search", ...]`.
 */
export function useCatalogSearch(input: SearchInput) {
  return useQuery(
    catalog().search.queryOptions({ input, enabled: input.query.length > 0 }),
  );
}
