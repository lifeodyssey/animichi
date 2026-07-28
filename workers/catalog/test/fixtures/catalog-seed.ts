/**
 * Contract-derived seed fixtures for the catalog spikes.
 *
 * Every fixture value is parsed through `packages/contract` (the cross-service
 * source of truth) at construction, so a fixture that no longer matches the wire
 * contract fails loudly HERE instead of surfacing as a downstream 400/500 in a
 * live spike run. The INSERT statements are emitted from the same records the
 * assertions read, so the seed and the expectation cannot drift apart.
 */

import {
  AnimeCandidate,
  Latitude,
  Longitude,
  PointsByWorkIdInput,
  ResolveOutcome,
} from "@seichijunrei/contract";

/** A parameterized statement: placeholder SQL plus its positional values. */
export interface SeedStatement {
  text: string;
  values: (string | number)[];
}

export interface WorkSeed {
  workId: string;
  title: string;
}

export interface PointSeed {
  id: string;
  workId: string;
  name: string;
  latitude: number;
  longitude: number;
}

export interface AliasSeed {
  workId: string;
  alias: string;
  normalized: string;
  source: string;
  priority: number;
}

/** A work id the contract accepts on `pointsByWorkId` (bare Bangumi subject id). */
export function contractWorkId(candidate: string): string {
  return PointsByWorkIdInput.parse({ work_id: candidate }).work_id;
}

export function workSeed(id: string, title: string): WorkSeed {
  return { workId: contractWorkId(id), title };
}

export function pointSeed(
  id: string,
  work: WorkSeed,
  name: string,
  latitude: number,
  longitude: number,
): PointSeed {
  return {
    id,
    workId: work.workId,
    name,
    latitude: Latitude.parse(latitude),
    longitude: Longitude.parse(longitude),
  };
}

export function aliasSeed(
  work: WorkSeed,
  alias: string,
  normalized: string,
  source: string,
  priority: number,
): AliasSeed {
  return { workId: work.workId, alias, normalized, source, priority };
}

/** Expected resolve candidate, validated against the shared `AnimeCandidate`. */
export function candidateOf(work: WorkSeed, pointsCount: number): AnimeCandidate {
  return AnimeCandidate.parse({
    bangumi_id: work.workId,
    title: work.title,
    points_count: pointsCount,
  });
}

/** Expected `resolved` outcome, validated against the shared `ResolveOutcome`. */
export function resolvedOutcome(work: WorkSeed, pointsCount: number): ResolveOutcome {
  return ResolveOutcome.parse({ outcome: "resolved", match: candidateOf(work, pointsCount) });
}

/** Expected `needs_disambiguation` outcome, validated against `ResolveOutcome`. */
export function ambiguousOutcome(candidates: readonly AnimeCandidate[]): ResolveOutcome {
  return ResolveOutcome.parse({
    outcome: "needs_disambiguation",
    reason: "anime_ambiguity",
    candidates,
  });
}

function placeholderGroup(row: number, columns: number): string {
  const slots = Array.from({ length: columns }, (_, index) =>
    `$${String(row * columns + index + 1)}`);
  return `(${slots.join(", ")})`;
}

function statement(
  table: string,
  columns: readonly string[],
  rows: readonly (readonly (string | number)[])[],
): SeedStatement {
  const groups = rows.map((_, row) => placeholderGroup(row, columns.length));
  return {
    text: `INSERT INTO ${table} (${columns.join(", ")}) VALUES ${groups.join(", ")}`,
    values: rows.flatMap((row) => [...row]),
  };
}

export function workInsert(seeds: readonly WorkSeed[]): SeedStatement {
  return statement("bangumi", ["id", "title"], seeds.map((s) => [s.workId, s.title]));
}

/** Coordinates only — the DB trigger derives the GEOGRAPHY `location` column. */
export function pointInsert(seeds: readonly PointSeed[]): SeedStatement {
  return statement(
    "points",
    ["id", "bangumi_id", "name", "latitude", "longitude"],
    seeds.map((s) => [s.id, s.workId, s.name, s.latitude, s.longitude]),
  );
}

export function aliasInsert(seeds: readonly AliasSeed[]): SeedStatement {
  return statement(
    "aliases",
    ["work_id", "alias", "alias_normalized", "source", "priority"],
    seeds.map((s) => [s.workId, s.alias, s.normalized, s.source, s.priority]),
  );
}
