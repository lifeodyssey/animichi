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
  /** The ids that added no distinct row, in pick order. */
  readonly omittedIds: readonly string[];
}

/** What a merge accumulates as it walks the picked works in fetch order. */
interface MergeTally {
  readonly seen: Set<string>;
  /** The works that put at least one row the merge did not already have. */
  readonly contributors: Set<string>;
}

/**
 * The rows this work adds that no earlier work already added, and the record
 * that it added any at all.
 *
 * Contribution is decided HERE, while the distinct rows are inserted, rather
 * than from the work's own row count. Python's `_contributed` asked only
 * `result.rows` — whether the work answered with anything — which counts a work
 * whose every spot an earlier pick already contributed. That work adds nothing
 * to the merge, and `omittedIds` is what the reply discloses and what makes the
 * payload `partial`; a disclosure that a work was included when the merge is
 * byte-identical without it tells the user the opposite of what happened.
 */
function contributionOf(work: FetchedWork, tally: MergeTally): Point[] {
  const added: Point[] = [];
  for (const row of work.result.rows) {
    if (tally.seen.has(row.id)) continue;
    tally.seen.add(row.id);
    added.push(row);
  }
  if (added.length > 0) tally.contributors.add(work.bangumiId);
  return added;
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
  const tally: MergeTally = { seen: new Set(), contributors: new Set() };
  const rows = fetched.flatMap((work) => contributionOf(work, tally));
  const omittedIds = picked.filter((bangumiId) => !tally.contributors.has(bangumiId));
  const partial = fetched.some((work) => work.result.partial === true) || omittedIds.length > 0;
  return { payload: buildSearchResultPayload(rows, "multi", null, partial, locale), omittedIds };
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
