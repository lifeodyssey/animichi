/** A `CatalogClient` that answers from a script and records what it was asked.
 * Truthful by construction: every payload a test hands it is a real catalog
 * response shape, copied from `workers/catalog`'s own tests. Named for what it
 * builds, per .claude/rules/naming-ownership.md. */
import type { GeocodeCandidate, Itinerary, LatLng, Pacing, Point, ResolveOutcome, SearchResult } from "@animichi/contract";
import type { CatalogClient } from "../../src/agent/tools/catalog-client.ts";
import { CatalogUnavailableError } from "../../src/agent/tools/catalog-client.ts";

/** The answers one scripted catalog gives, each optional. */
export interface CatalogScript {
  resolve?: ResolveOutcome;
  points?: SearchResult;
  nearby?: Point[];
  geocode?: GeocodeCandidate[];
  itinerary?: Itinerary;
}

/** What the tools actually asked the catalog for. */
export interface CatalogCalls {
  resolved: string[];
  fetched: string[];
  searched: { around: LatLng; radiusM: number }[];
  geocoded: string[];
  planned: { pointIds: string[]; pacing: Pacing | undefined }[];
}

/** A scripted catalog plus the call log the test reads back. */
export interface ScriptedCatalog {
  catalog: CatalogClient;
  calls: CatalogCalls;
}

/** The answer this script gives, or the failure a missing answer stands for. */
function answer<T>(scripted: T | undefined, procedure: string): Promise<T> {
  if (scripted === undefined) return Promise.reject(new CatalogUnavailableError(`${procedure}: no answer scripted`));
  return Promise.resolve(scripted);
}

/** Build a scripted catalog over the given answers. */
export function scriptedCatalog(script: CatalogScript): ScriptedCatalog {
  const calls: CatalogCalls = { resolved: [], fetched: [], searched: [], geocoded: [], planned: [] };
  const catalog: CatalogClient = {
    resolve: (query) => {
      calls.resolved.push(query);
      return answer(script.resolve, "resolve");
    },
    pointsByBangumiId: (bangumiId) => {
      calls.fetched.push(bangumiId);
      return answer(script.points, "points-by-bangumi-id");
    },
    nearby: (around, radiusM) => {
      calls.searched.push({ around, radiusM });
      return answer(script.nearby, "nearby");
    },
    geocode: (query) => {
      calls.geocoded.push(query);
      return answer(script.geocode, "geocode");
    },
    planItinerary: (pointIds, pacing) => {
      calls.planned.push({ pointIds, pacing });
      return answer(script.itinerary, "itinerary");
    },
  };
  return { catalog, calls };
}
