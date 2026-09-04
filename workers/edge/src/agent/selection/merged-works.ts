/**
 * Several works' spots as one search result (card #1288).
 *
 * Port of `selection.py::_merge_results` × `_contributed`, and the reason it is
 * its own concept: the merge is the only part of a multi-work pick that is pure
 * — no catalog, no session, no clock — and it is the part with rules worth
 * stating. Rows are deduplicated by point id and kept in the order the picked
 * works were fetched in, so the same pick always merges to the same rows; a
 * work that contributed no row at all is OMITTED, which is both a fact the
 * reply discloses and a reason the result counts as partial.
 */
import type { Point, SearchResult } from "@animichi/contract";
import { buildSearchResultPayload } from "../tools/search-result-payload.ts";
import type { OrderedCandidate, SearchResultPayload } from "../tools/catalog-tool-session.ts";

/** One picked work and what the catalog answered for it. */
export interface FetchedWork {
  readonly bangumiId: string;
  readonly result: SearchResult;
}

/** The merge of several works, with the works it left out. */
export interface MergedWorks {
  readonly payload: SearchResultPayload;
  /** The ids that contributed no row, in pick order. */
  readonly omittedIds: readonly string[];
}

/** Whether this work put at least one row into the merge. */
function contributed(bangumiId: string, fetched: readonly FetchedWork[]): boolean {
  return fetched.some((work) => work.bangumiId === bangumiId && work.result.rows.length > 0);
}

/** Every row once, in fetch order — Python's `seen` set over `result.rows`. */
function distinctRows(fetched: readonly FetchedWork[]): Point[] {
  const seen = new Set<string>();
  const rows: Point[] = [];
  for (const row of fetched.flatMap((work) => work.result.rows)) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    rows.push(row);
  }
  return rows;
}

/**
 * The merged payload.
 *
 * `partial` is Python's `any(result.partial) or bool(omitted)`: a work still
 * syncing and a work that answered with nothing are the same warning to the
 * router downstream, which is that this pick is not the whole picture yet.
 * `anime_id` is null because a merge is about several works and the wire's
 * single `bangumi_id` can only name one — Python kept the list in a field the
 * wire never published.
 *
 * ONE DELIBERATE DIFFERENCE from `_merge_results`: the rows go through
 * `buildSearchResultPayload`, so their Anitabi screenshots are proxied like
 * every other search result's. Python's merge localized city names by hand and
 * skipped the rewrite its own `build_search_state` applies everywhere else,
 * which left a merged card pointing at `image.anitabi.cn` directly — an
 * inconsistency, not a contract: `image_url_rewrite` exists because those URLs
 * are not reliably loadable from a browser (`anitabi-image-proxy.ts`).
 */
export function mergedWorks(
  picked: readonly string[],
  fetched: readonly FetchedWork[],
  locale: string,
): MergedWorks {
  const omittedIds = picked.filter((bangumiId) => !contributed(bangumiId, fetched));
  const partial = fetched.some((work) => work.result.partial === true) || omittedIds.length > 0;
  const payload = buildSearchResultPayload(distinctRows(fetched), "multi", null, partial, locale);
  return { payload, omittedIds };
}

/** The omitted works as the reply names them: their offered titles, or the
 * bare ids when the question no longer knows them (Python's `_omitted_titles`). */
export function omittedTitles(
  omittedIds: readonly string[],
  candidates: readonly OrderedCandidate[],
): string[] {
  const titles = new Map(candidates.map((candidate) => [candidate.id, candidate.title]));
  return omittedIds.map((id) => titles.get(id) ?? id);
}
