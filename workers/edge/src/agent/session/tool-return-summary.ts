/**
 * The short form an old tool return shrinks to (card #1290) — port of
 * `apps/agent`'s `animichi_agent._summarize_tool_content` and
 * `history_compaction._candidate_summary`.
 *
 * DETERMINISTIC, and that is the point of the whole tier. A model-written
 * summary of a tool return is a second chance to get the identity wrong: the
 * candidate list an ordinal follow-up resolves against ("the second one") only
 * survives if something copies it verbatim, and prose asked nicely to preserve
 * it is not that something. So `resolve_anime`'s ambiguous return keeps its
 * ordered candidate ids exactly, and every other return collapses to one line
 * naming the tool and the one number the model still has to reason about.
 *
 * A ROUTE IS THE SECOND ORDERED THING (#1389, spec §九 9.2 (2)). `plan_route`
 * used to collapse to "planned route with N stops" — the count and nothing
 * else — so a later turn asking about "the second stop" was handed the number
 * of stops and not one of their identities. Since C-2 froze the short form at
 * write time that line is ALL a later turn ever sees of that route, which is
 * the loss 李博杰《深入理解 AI Agent》ch.2 names for a summariser that keeps the
 * shape and drops the identities. So the route keeps its itinerary ref and its
 * ordered stop ids verbatim, in `candidateSummary`'s own shape.
 *
 * THE BOUND IS ON EVERYTHING BUT THE IDS. `TOOL_RETURN_MAX_CHARS` is both the
 * length a return has to exceed to be worth shrinking and the length a short
 * form's droppable tail has to fit inside, so `total_minutes` is dropped from a
 * line the ids alone have already filled. The ids are never truncated and never
 * sampled: a route whose ids alone exceed the budget keeps all of them, because
 * a partial ordered list is worse than no list — it answers "the second stop"
 * and lies about "the eleventh".
 *
 * SO NAME THE CEILING, because "never truncated" is only safe if the worst case
 * is bounded and small enough to freeze forever. It is 500 ids. The catalog
 * refuses an itinerary request over `MAX_ITINERARY_POINT_IDS = 500`
 * (`workers/catalog/src/router.ts:64`), and while the timed kernel plans at most
 * `MAX_ITINERARY_CLUSTERS = 50` stops
 * (`workers/catalog/src/domain/itinerary/plan.ts:66`), each stop expands back to
 * ALL of its member points on the way out
 * (`workers/catalog/src/application/plan-itinerary.ts:104-105`) — so the id
 * count this line carries is the request's, not the kernel's, and 50 clusters
 * can be 500 points. A 500-stop route therefore freezes roughly 14 KB — 500
 * ids of the catalog's own length — into the session's context permanently,
 * against a 200-character bound for everything else. That is the price paid on
 * purpose:
 * `test/agent-route-summary.test.ts` pins the case and prints the byte size, so
 * the cost is a number a reader meets rather than a surprise. Should it ever
 * stop being worth paying, the lever is the catalog's cap, not a sampled list
 * here.
 *
 * The vocabulary is the catalog outcomes' own (`tools/catalog-tool-outcomes.ts`
 * — `outcome`, `candidate_ids`, `row_count`, `anime_title`, `point_count`),
 * which is the same vocabulary Python read, so a summary line here is the line
 * the eval trajectories were written against. `ordered_point_ids` is the one
 * word Python has no counterpart for, and that file argues why it exists.
 */
import { isJsonRecord } from "../json-record.ts";

/**
 * The length a tool return has to exceed before it is worth a short form, and
 * the length a short form's own droppable tail has to fit inside.
 *
 * It lives with the summariser rather than beside the freeze decision because
 * both now read it and `frozen-tool-return.ts` imports THIS module to build a
 * line; putting the number there would make the pair a cycle.
 */
export const TOOL_RETURN_MAX_CHARS = 200;

/** The tool return as a record, or nothing when it is not JSON at all. */
function decoded(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return isJsonRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** The ordered candidate ids, kept verbatim — the one thing no prose may lose. */
function candidateSummary(data: Record<string, unknown>): string | null {
  if (data.outcome !== "needs_disambiguation" || !Array.isArray(data.candidate_ids)) return null;
  return `[resolve_anime: ambiguous, ordered_candidates=${JSON.stringify(data.candidate_ids)}]`;
}

function animeTitleIn(data: Record<string, unknown>): string {
  return typeof data.anime_title === "string" ? data.anime_title : "";
}

/** A scalar field as the summary prints it; anything richer prints as nothing,
 * since a nested object in a count position is not a number the model can use. */
function scalar(value: unknown): string {
  if (typeof value === "number") return String(value);
  return typeof value === "string" ? value : "";
}

/** Python read `row_count` and fell back to `note`; an outcome carrying neither
 * (a `search_bangumi` that found the work but no points) summarises to the same
 * empty count it did there. */
function searchSummary(toolName: string, data: Record<string, unknown>): string {
  const rows = scalar(data.row_count ?? data.note ?? "");
  const title = animeTitleIn(data);
  const forTitle = title === "" ? "" : ` for ${title}`;
  return `[${toolName}: found ${rows} spots${forTitle}]`;
}

function resolveSummary(data: Record<string, unknown>): string {
  if (data.outcome === "needs_disambiguation") {
    const count = Array.isArray(data.candidate_ids) ? data.candidate_ids.length : 0;
    return `[resolve_anime: ambiguous, ${String(count)} candidates]`;
  }
  return `[resolve_anime: resolved to ${animeTitleIn(data)} (id=${scalar(data.bangumi_id)})]`;
}

/** One route's short form, in the shape `isFrozenSummary` recognises. */
function routeLine(body: string): string {
  return `[plan_route: ${body}]`;
}

/** The route facts no bound may touch: the ref the route is stored under, and
 * its stops in visit order. */
function routeIdentity(data: Record<string, unknown>, stopIds: unknown[]): string {
  return `itinerary_ref=${scalar(data.itinerary_ref)}, ordered_stops=${JSON.stringify(stopIds)}`;
}

/** The duration, or nothing at all when keeping it would put the line over the
 * bound — the only part of a route summary that is allowed to go. */
function routeDuration(identity: string, data: Record<string, unknown>): string {
  const tail = `, total_minutes=${scalar(data.total_minutes ?? 0)}`;
  return routeLine(identity + tail).length > TOOL_RETURN_MAX_CHARS ? "" : tail;
}

/** A routed outcome keeps its identities; every other one has none to keep,
 * and reads as the count line Python wrote. */
function routeSummary(data: Record<string, unknown>): string {
  const stopIds = data.ordered_point_ids;
  if (data.status !== "ok" || !Array.isArray(stopIds)) {
    return routeLine(`planned route with ${scalar(data.point_count ?? 0)} stops`);
  }
  const identity = routeIdentity(data, stopIds);
  return routeLine(identity + routeDuration(identity, data));
}

/** The line a tool's own shape reduces to, by tool. */
function shapeSummary(toolName: string, data: Record<string, unknown>): string {
  if (toolName === "search_bangumi" || toolName === "search_nearby") {
    return searchSummary(toolName, data);
  }
  if (toolName === "resolve_anime") return resolveSummary(data);
  if (toolName === "plan_route") return routeSummary(data);
  return `[${toolName}: completed]`;
}

/** What an old, long tool return is replaced by in the model's context. */
export function toolReturnSummary(toolName: string, text: string): string {
  const data = decoded(text);
  if (data === null) return `[${toolName}: completed]`;
  const candidates = toolName === "resolve_anime" ? candidateSummary(data) : null;
  return candidates ?? shapeSummary(toolName, data);
}
