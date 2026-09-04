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
 * The vocabulary is the catalog outcomes' own (`tools/catalog-tool-outcomes.ts`
 * — `outcome`, `candidate_ids`, `row_count`, `anime_title`, `point_count`),
 * which is the same vocabulary Python read, so a summary line here is the line
 * the eval trajectories were written against.
 */
import { isJsonRecord } from "../json-record.ts";

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

function routeSummary(data: Record<string, unknown>): string {
  return `[plan_route: planned route with ${scalar(data.point_count ?? 0)} stops]`;
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
