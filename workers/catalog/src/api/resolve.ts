/** Deterministic anime-title resolver over the alias index and Bangumi MISS path. */
import { MAX_CANDIDATES } from "@seichijunrei/contract/constants";
import { sql } from "drizzle-orm";
import type { CatalogDb } from "../db/client";
import { parseBangumi, type BangumiRow } from "../enrich/parse";
import {
  BANGUMI_FETCH_N,
  fetchBangumiSubjects,
  UpstreamFetchError,
  type BangumiSearchSubject,
  type FetchLike,
} from "../ingest/sources";
import { normalizeAlias } from "../lib/alias";
import { optional } from "../lib/optional";
import type { AnimeCandidate, ResolveOutcome } from "../types";

export { MAX_CANDIDATES };

export interface AliasWork {
  work_id: string;
  priority: number;
}

export interface ResolveDb {
  worksForAlias(aliasNormalized: string): Promise<AliasWork[]>;
  candidatesForWorks(workIds: string[]): Promise<AnimeCandidate[]>;
}

export interface ResolveOptions {
  fetchImpl?: FetchLike;
}

/** Resolve a title without model judgment or nondeterministic state. */
export async function resolve(
  db: ResolveDb,
  input: { query: string },
  opts: ResolveOptions = {},
): Promise<ResolveOutcome> {
  const rows = await db.worksForAlias(normalizeAlias(input.query));
  const works = dedupeWorks(rows);
  if (works.length > 0) {
    const hit = await resolveHit(db, works);
    if (hit) return hit;
  }
  return resolveMiss(input.query, opts.fetchImpl);
}

/** Apply the top-priority tie rule to alias-index works. */
async function resolveHit(db: ResolveDb, works: AliasWork[]): Promise<ResolveOutcome | undefined> {
  const candidates = await db.candidatesForWorks(works.map((work) => work.work_id));
  const survivors = survivingWorks(works, candidates);
  if (survivors.length === 0) return undefined;
  const top = topPriorityWorks(survivors);
  const topCandidates = candidatesForWorks(top, candidates);
  if (top.length === 1) return resolved(topCandidates[0]);
  return ambiguous(rankCandidates(top, topCandidates).slice(0, MAX_CANDIDATES));
}

/** Collapse repeated source rows by work id, retaining each work's max priority. */
function dedupeWorks(rows: AliasWork[]): AliasWork[] {
  const priorities = new Map<string, number>();
  for (const row of rows) {
    priorities.set(row.work_id, Math.max(priorities.get(row.work_id) ?? -Infinity, row.priority));
  }
  return [...priorities].map(([work_id, priority]) => ({ work_id, priority }));
}

/** Keep only alias works backed by loadable Bangumi metadata. */
function survivingWorks(works: AliasWork[], candidates: AnimeCandidate[]): AliasWork[] {
  const ids = new Set(candidates.map((candidate) => candidate.bangumi_id));
  return works.filter((work) => ids.has(work.work_id));
}

function topPriorityWorks(works: AliasWork[]): AliasWork[] {
  const maxPriority = Math.max(...works.map((work) => work.priority));
  return works.filter((work) => work.priority === maxPriority);
}

function candidatesForWorks(works: AliasWork[], candidates: AnimeCandidate[]): AnimeCandidate[] {
  const ids = new Set(works.map((work) => work.work_id));
  return candidates.filter((candidate) => ids.has(candidate.bangumi_id));
}

/** Rank by priority desc, point coverage desc/null-last, then stable id asc. */
function rankCandidates(works: AliasWork[], candidates: AnimeCandidate[]): AnimeCandidate[] {
  const priorities = new Map(works.map((work) => [work.work_id, work.priority]));
  return [...candidates].sort((left, right) => compareCandidates(left, right, priorities));
}

function compareCandidates(left: AnimeCandidate, right: AnimeCandidate, priorities: Map<string, number>): number {
  const priority = priorityRank(right, priorities) - priorityRank(left, priorities);
  if (priority !== 0) return priority;
  const points = pointRank(right) - pointRank(left);
  return points !== 0 ? points : compareText(left.bangumi_id, right.bangumi_id);
}

function priorityRank(candidate: AnimeCandidate, priorities: Map<string, number>): number {
  return priorities.get(candidate.bangumi_id) ?? -1;
}

function pointRank(candidate: AnimeCandidate): number {
  return candidate.points_count ?? -1;
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  return left > right ? 1 : 0;
}

/** Bangumi MISS: only multiple normalized exact names trigger clarification. */
async function resolveMiss(query: string, fetchImpl?: FetchLike): Promise<ResolveOutcome> {
  let subjects: BangumiSearchSubject[];
  try {
    subjects = await fetchBangumiSubjects(query, { limit: BANGUMI_FETCH_N, fetchImpl });
  } catch (error) {
    if (error instanceof UpstreamFetchError) {
      return { outcome: "upstream_unavailable", provider: "bangumi" };
    }
    throw error;
  }
  return resolveSubjects(query, subjects);
}

function resolveSubjects(query: string, subjects: BangumiSearchSubject[]): ResolveOutcome {
  const candidates = subjects.flatMap(safeSubjectCandidate);
  if (candidates.length === 0) return { outcome: "not_found", reason: "anime_not_found" };
  const exact = exactCandidates(query, candidates);
  if (exact.length >= 2) return ambiguous(exact.slice(0, MAX_CANDIDATES));
  return resolved(candidates[0]);
}

function exactCandidates(query: string, candidates: AnimeCandidate[]): AnimeCandidate[] {
  const normalized = normalizeAlias(query);
  return candidates.filter((candidate) =>
    normalizeAlias(candidate.title) === normalized
    || normalizeAlias(candidate.title_cn ?? "") === normalized,
  );
}

/** Reuse the ingest parser for real `images` and `date`/`air_date` fields. */
function subjectCandidate(subject: BangumiSearchSubject): AnimeCandidate {
  return rowCandidate(parseBangumi(subject.id, subject));
}

function safeSubjectCandidate(subject: BangumiSearchSubject): AnimeCandidate[] {
  try {
    return [subjectCandidate(subject)];
  } catch {
    return [];
  }
}

function rowCandidate(row: BangumiRow, points_count?: number): AnimeCandidate {
  const meta = optional({
    title_cn: row.title_cn, cover_url: row.cover_url,
    year: pickYear(row.air_date), points_count,
  });
  return { bangumi_id: row.id, title: row.title, ...meta };
}

function pickYear(airDate: string | null): number | undefined {
  if (!airDate) return undefined;
  const year = Number.parseInt(airDate.slice(0, 4), 10);
  return Number.isFinite(year) ? year : undefined;
}

function resolved(match: AnimeCandidate | undefined): ResolveOutcome {
  if (!match) throw new Error("Resolver produced no candidate");
  return { outcome: "resolved", match };
}

function ambiguous(candidates: AnimeCandidate[]): ResolveOutcome {
  return { outcome: "needs_disambiguation", reason: "anime_ambiguity", candidates };
}

/** Build the production resolver reads over parameterized raw SQL. */
export function resolveDb(db: CatalogDb): ResolveDb {
  return {
    worksForAlias: (normalized) => selectAliasWorks(db, normalized),
    candidatesForWorks: (workIds) => selectCandidates(db, workIds),
  };
}

async function selectAliasWorks(db: CatalogDb, normalized: string): Promise<AliasWork[]> {
  const result = await db.execute(sql`
    SELECT work_id, MAX(priority) AS priority
    FROM aliases WHERE alias_normalized = ${normalized}
    GROUP BY work_id
  `);
  return result.rows.map(readAliasWork);
}

async function selectCandidates(db: CatalogDb, workIds: string[]): Promise<AnimeCandidate[]> {
  const result = await db.execute(sql`
    SELECT b.id, b.title, b.title_cn, b.cover_url, b.air_date,
           COUNT(p.id) AS points_count
    FROM bangumi b LEFT JOIN points p ON p.bangumi_id = b.id
    WHERE b.id = ANY(${workIds}::text[])
    GROUP BY b.id, b.title, b.title_cn, b.cover_url, b.air_date
  `);
  return result.rows.map(readStoredCandidate);
}

function readAliasWork(row: Record<string, unknown>): AliasWork {
  return { work_id: requiredString(row, "work_id"), priority: requiredNumber(row, "priority") };
}

function readStoredCandidate(row: Record<string, unknown>): AnimeCandidate {
  const parsed: BangumiRow = {
    id: requiredString(row, "id"), title: requiredString(row, "title"),
    title_cn: nullableString(row, "title_cn"), cover_url: nullableString(row, "cover_url"),
    air_date: nullableString(row, "air_date"), summary: null, rating: null, eps_count: null,
  };
  return rowCandidate(parsed, requiredNumber(row, "points_count"));
}

function requiredString(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== "string") throw new Error(`Catalog row ${key} is not a string`);
  return value;
}

function nullableString(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new Error(`Catalog row ${key} is not nullable text`);
  return value;
}

function requiredNumber(row: Record<string, unknown>, key: string): number {
  const value = Number(row[key]);
  if (!Number.isFinite(value)) throw new Error(`Catalog row ${key} is not numeric`);
  return value;
}
