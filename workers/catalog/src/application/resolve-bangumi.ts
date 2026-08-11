/**
 * `resolve` application use case: deterministic exact-first anime-title
 * resolution. Orchestration only — the Neon alias read arrives through the
 * `TitleAliasPort` (adapted in `adapters/outbound/title-alias.ts`) and Bangumi
 * search through the `UpstreamTitlePort` (adapted in
 * `adapters/outbound/bangumi-search.ts`). No I/O, no SQL here.
 *
 * Exact-first: a normalized-alias hit returns immediately; the upstream
 * (ingest) search runs only on an exact miss. The `resolved`/ambiguity policy,
 * similarity guards, and candidate cap are application rules.
 *
 * Observability: `ResolveObserverPort` records a redacted observation —
 * typed outcome, candidate count, source class, duration — never the query
 * text or an upstream body.
 */

import { MAX_CANDIDATES } from "@animichi/contract/constants";
import { parseBangumi, type BangumiRow } from "../enrich/parse";
import { normalizeAlias } from "../lib/alias";
import { optional } from "../lib/optional";
import type { BangumiSearchSubject } from "../ingest/sources";
import type { AnimeCandidate, ResolveOutcome } from "../types";

export { MAX_CANDIDATES };

const MIN_QUERY_LEN = 2;
const MIN_SIMILAR_LEN = 2;
const MAX_REVERSE_RATIO = 3;

/** One alias-indexed work: the id plus its highest alias-source priority. */
export interface AliasWork {
  bangumi_id: string;
  priority: number;
}

/** Outbound capability: read the Neon alias index for exact title matches. */
export interface TitleAliasPort {
  worksForAlias(aliasNormalized: string): Promise<AliasWork[]>;
  candidatesForWorks(workIds: string[]): Promise<AnimeCandidate[]>;
}

/** Bangumi search payload, or the typed transport-failure sentinel. */
export type UpstreamSubjects = BangumiSearchSubject[] | "upstream_unavailable";

/** Outbound capability: search Bangumi subjects (the explicit ingest adapter). */
export interface UpstreamTitlePort {
  fetchSubjects(query: string): Promise<UpstreamSubjects>;
}

/** Redacted resolution observation: never carries query text or upstream body. */
export interface ResolveObservation {
  outcome: ResolveOutcome["outcome"];
  candidate_count: number;
  source_class: "alias" | "upstream";
  duration_ms: number;
}

export interface ResolveObserverPort {
  record(observation: ResolveObservation): void;
}

/** Injectable clock so duration is deterministic in tests. */
export interface ResolveClock {
  now(): number;
}

/** Inputs for {@link resolveBangumi} — mirrors `ResolveInput` in the contract. */
export interface ResolveInput {
  query: string;
}

export interface ResolveOptions {
  observer?: ResolveObserverPort;
  clock?: ResolveClock;
}

/** A resolution plus the source class that produced it (for observability). */
interface ResolveResult {
  outcome: ResolveOutcome;
  source: "alias" | "upstream";
}

/** Resolve a title deterministically, exact alias first, upstream on miss. */
export async function resolveBangumi(
  alias: TitleAliasPort,
  upstream: UpstreamTitlePort,
  input: ResolveInput,
  opts: ResolveOptions = {},
): Promise<ResolveOutcome> {
  const clock = opts.clock ?? realClock;
  const started = clock.now();
  const result = await resolveExactFirst(alias, upstream, input.query);
  recordIfObserved(opts, observe(result, started, clock.now()));
  return result.outcome;
}

function recordIfObserved(opts: ResolveOptions, observation: ResolveObservation): void {
  opts.observer?.record(observation);
}

/** Exact-first sequencing: the alias index decides before any upstream call. */
async function resolveExactFirst(
  alias: TitleAliasPort,
  upstream: UpstreamTitlePort,
  query: string,
): Promise<ResolveResult> {
  const hit = await aliasHit(alias, normalizeAlias(query));
  if (hit) return { outcome: hit, source: "alias" };
  return { outcome: await resolveMiss(upstream, query), source: "upstream" };
}

/** Resolve through the alias index; undefined when the alias matches nothing. */
async function aliasHit(alias: TitleAliasPort, query: string): Promise<ResolveOutcome | undefined> {
  const works = dedupeWorks(await alias.worksForAlias(query));
  if (works.length === 0) return undefined;
  return resolveHit(alias, works);
}

/** Apply the top-priority tie rule to alias-index works. */
async function resolveHit(alias: TitleAliasPort, works: AliasWork[]): Promise<ResolveOutcome | undefined> {
  const candidates = await alias.candidatesForWorks(works.map((work) => work.bangumi_id));
  const survivors = survivingWorks(works, candidates);
  if (survivors.length === 0) return undefined;
  const top = topPriorityWorks(survivors);
  const topCandidates = candidatesForWorks(top, candidates);
  if (top.length === 1) return resolved(topCandidates[0]);
  return ambiguous(rankCandidates(top, topCandidates).slice(0, MAX_CANDIDATES));
}

/** Bangumi MISS: deterministic guarded name similarity partitions the results. */
async function resolveMiss(upstream: UpstreamTitlePort, query: string): Promise<ResolveOutcome> {
  const subjects = await upstream.fetchSubjects(query);
  return subjects === "upstream_unavailable"
    ? { outcome: "upstream_unavailable", provider: "bangumi" }
    : resolveSubjects(query, subjects);
}

/** Collapse repeated source rows by work id, retaining each work's max priority. */
function dedupeWorks(rows: AliasWork[]): AliasWork[] {
  const priorities = new Map<string, number>();
  for (const row of rows) {
    priorities.set(row.bangumi_id, Math.max(priorities.get(row.bangumi_id) ?? -Infinity, row.priority));
  }
  return [...priorities].map(([bangumi_id, priority]) => ({ bangumi_id, priority }));
}

/** Keep only alias works backed by loadable Bangumi metadata. */
function survivingWorks(works: AliasWork[], candidates: AnimeCandidate[]): AliasWork[] {
  const ids = new Set(candidates.map((candidate) => candidate.bangumi_id));
  return works.filter((work) => ids.has(work.bangumi_id));
}

function topPriorityWorks(works: AliasWork[]): AliasWork[] {
  const maxPriority = Math.max(...works.map((work) => work.priority));
  return works.filter((work) => work.priority === maxPriority);
}

function candidatesForWorks(works: AliasWork[], candidates: AnimeCandidate[]): AnimeCandidate[] {
  const ids = new Set(works.map((work) => work.bangumi_id));
  return candidates.filter((candidate) => ids.has(candidate.bangumi_id));
}

/** Rank by priority desc, point coverage desc/null-last, then stable id asc. */
function rankCandidates(works: AliasWork[], candidates: AnimeCandidate[]): AnimeCandidate[] {
  const priorities = new Map(works.map((work) => [work.bangumi_id, work.priority]));
  return [...candidates].sort((left, right) => compareCandidates(left, right, priorities));
}

function compareCandidates(
  left: AnimeCandidate,
  right: AnimeCandidate,
  priorities: Map<string, number>,
): number {
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

function resolveSubjects(query: string, subjects: BangumiSearchSubject[]): ResolveOutcome {
  const candidates = subjects.flatMap(safeSubjectCandidate);
  if (candidates.length === 0) return { outcome: "not_found", reason: "anime_not_found" };
  const similar = similarCandidates(query, subjects);
  if (similar.length >= 2) return ambiguous(similar);
  if (similar.length === 1) return resolved(similar[0]);
  return resolved(candidates[0]);
}

function similarCandidates(query: string, subjects: BangumiSearchSubject[]): AnimeCandidate[] {
  const q = normalizeAlias(query);
  if (q === "") return [];
  return subjects
    .filter((subject) => isSimilar(subjectName(subject.name) ?? "", subjectName(subject.name_cn), q))
    .flatMap(safeSubjectCandidate)
    .slice(0, MAX_CANDIDATES);
}

function isSimilar(name: string, nameCn: string | undefined, q: string): boolean {
  const n = normalizeAlias(name);
  const ncn = normalizeAlias(nameCn ?? "");
  return matchesName(n, q) || matchesName(ncn, q);
}

function matchesName(n: string, q: string): boolean {
  if (n.length === 0 || n === q) return n.length !== 0;
  if (q.length < MIN_QUERY_LEN) return false;
  if (n.includes(q)) return true;
  return isReverseSimilar(n, q);
}

function isReverseSimilar(n: string, q: string): boolean {
  return (
    q.includes(n)
    && n.length >= MIN_SIMILAR_LEN
    && q.length <= n.length * MAX_REVERSE_RATIO
  );
}

function subjectName(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** Reuse the ingest parser for real `images` and `date`/`air_date` fields. */
function subjectCandidate(subject: BangumiSearchSubject): AnimeCandidate {
  return candidateFromRow(parseBangumi(subject.id, subject));
}

function safeSubjectCandidate(subject: BangumiSearchSubject): AnimeCandidate[] {
  try {
    return [subjectCandidate(subject)];
  } catch {
    return [];
  }
}

/** Map a parsed Bangumi row (+ optional derived point count) to a candidate. */
export function candidateFromRow(row: BangumiRow, points_count?: number): AnimeCandidate {
  const meta = optional({
    title_cn: row.title_cn,
    cover_url: row.cover_url,
    year: pickYear(row.air_date),
    points_count,
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

/** Build the redacted observation; duration is the injected clock's span. */
function observe(result: ResolveResult, started: number, finished: number): ResolveObservation {
  return {
    outcome: result.outcome.outcome,
    candidate_count: candidateCount(result.outcome),
    source_class: result.source,
    duration_ms: Math.max(0, finished - started),
  };
}

function candidateCount(outcome: ResolveOutcome): number {
  if (outcome.outcome === "needs_disambiguation") return outcome.candidates.length;
  return outcome.outcome === "resolved" ? 1 : 0;
}

const realClock: ResolveClock = { now: () => Date.now() };
