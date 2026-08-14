/**
 * Current-season discovery (#1006 AC2, MAJOR-1): the Bangumi calendar week's
 * anime ids. The calendar endpoint returns 7 weekday buckets of airing subjects;
 * we flatten them into one deduped, order-stable bangumi id list that feeds the
 * `current_season` discovery source. Reuses the shared `sources.ts` HTTP client
 * (retry + UpstreamFetchError), so a Bangumi outage surfaces as a typed failure
 * the caller may degrade. A malformed body yields an empty list, never a throw.
 */
import { BANGUMI_BASE, fetchJson, type SourceConfig, type UpstreamName } from "./sources";

/** Fetch the current calendar week's bangumi ids (deduped, order-stable). */
export async function fetchCurrentSeason(cfg: SourceConfig = {}): Promise<readonly string[]> {
  const url = (cfg.bangumiBaseUrl ?? BANGUMI_BASE) + "/calendar";
  return calendarIds(await fetchJson(url, BANGUMI_UPSTREAM, cfg));
}

const BANGUMI_UPSTREAM: UpstreamName = "bangumi";

/** Coerce a calendar week body into a deduped, order-stable bangumi id list. */
function calendarIds(body: unknown): string[] {
  if (!Array.isArray(body)) return [];
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const day of body) {
    if (!isObject(day) || !Array.isArray(day.items)) continue;
    collectCalendarIds(day.items, ids, seen);
  }
  return ids;
}

/** Flatten one weekday bucket's subject ids into the shared deduped list. */
function collectCalendarIds(items: unknown, ids: string[], seen: Set<string>): void {
  if (!Array.isArray(items)) return;
  for (const item of items) {
    if (!isObject(item)) continue;
    const id = subjectId(item.id);
    if (id === null || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
}

/** Coerce a subject's `id` (number or numeric string) to a string, else null. */
function subjectId(id: unknown): string | null {
  if (typeof id === "number") return String(id);
  return typeof id === "string" && id.length > 0 ? id : null;
}

/** Narrow an unknown value to a plain JSON object. */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
