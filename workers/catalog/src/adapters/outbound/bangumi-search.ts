/**
 * Outbound adapter for the `UpstreamTitlePort`: the explicit upstream-ingest
 * adapter over the Bangumi search fetcher. Maps the fetcher's typed transport
 * failure to the `upstream_unavailable` sentinel; every other failure stays an
 * error. Search policy (similarity, cap) stays in the application use case.
 *
 * It also satisfies the composed `SubjectParserPort`: knowing Bangumi's payload
 * shape (`images`, `date` vs `air_date`) is this adapter's job, so the use case
 * never reads a raw upstream field.
 */

import type {
  CandidateFields, SubjectParserPort, TitleSubject, UpstreamSubjects, UpstreamTitlePort,
} from "../../application/resolve-bangumi";
import { parseBangumi } from "../../enrich/parse";
import type { RetryOptions } from "../../ingest/retry";
import {
  BANGUMI_FETCH_N,
  fetchBangumiSubjects,
  UpstreamFetchError,
  type FetchLike,
} from "../../ingest/sources";

/** Injectable knobs for the Bangumi search adapter (defaulted for prod). */
export interface BangumiTitleSearchConfig {
  fetchImpl?: FetchLike;
  retry?: RetryOptions;
}

/** Build the `UpstreamTitlePort` backed by the Bangumi search fetcher. */
export function bangumiTitleSearch(cfg: BangumiTitleSearchConfig = {}): UpstreamTitlePort {
  return { ...bangumiSubjectParser(), fetchSubjects: (query) => fetchSubjects(query, cfg) };
}

/** Build the `SubjectParserPort` for Bangumi's payload shape, on its own. */
export function bangumiSubjectParser(): SubjectParserPort {
  return { parseSubject: parseTitleSubject };
}

/** Narrow one Bangumi subject; `parseBangumi` throws when it carries no title. */
function parseTitleSubject(subject: TitleSubject): CandidateFields {
  return parseBangumi(subject.id, subject);
}

async function fetchSubjects(
  query: string,
  cfg: BangumiTitleSearchConfig,
): Promise<UpstreamSubjects> {
  try {
    return await fetchBangumiSubjects(query, { limit: BANGUMI_FETCH_N, ...cfg });
  } catch (error) {
    return classifyUpstreamError(error);
  }
}

function classifyUpstreamError(error: unknown): UpstreamSubjects {
  if (error instanceof UpstreamFetchError) return "upstream_unavailable";
  throw error;
}
