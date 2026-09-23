/**
 * Contract-derived seed fixtures for the catalog integration suite.
 *
 * Every fixture value is parsed through `packages/contract` (the cross-service
 * source of truth) at construction, so a fixture that no longer matches the wire
 * contract fails loudly HERE instead of surfacing as a downstream 400/500 in a
 * live integration run. The INSERT statements are emitted from the same records
 * the assertions read, so the seed and the expectation cannot drift apart.
 *
 * The table and column NAMES used to be read off the Drizzle schema, which left
 * the repository with #1633. They are written out below instead: the committed
 * Prisma chain is the schema authority now, and it has no string-keyed shape to
 * look a column up in. Nothing is lost by the change — a name that stops
 * matching the chain fails on the seeding statement itself, which is where a
 * wrong name was always going to surface.
 *
 * SCOPE: only seeds built through these builders carry that guarantee. The other
 * integration files still hand-write their INSERTs — converting them is tracked as a
 * follow-up to #363.
 */

import {
  AnimeCandidate,
  Latitude,
  Longitude,
  PointsByBangumiIdInput,
  ResolveOutcome,
} from "@animichi/contract";

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

/** A bangumi id the contract accepts on `pointsByBangumiId` (bare Bangumi subject id). */
export function contractBangumiId(candidate: string): string {
  return PointsByBangumiIdInput.parse({ bangumi_id: candidate }).bangumi_id;
}

export function workSeed(id: string, title: string): WorkSeed {
  return { workId: contractBangumiId(id), title };
}

export function pointSeed(
  id: string,
  work: WorkSeed,
  name: string,
  latitude: number,
  longitude: number,
): PointSeed {
  return { id, workId: work.workId, name, latitude: Latitude.parse(latitude), longitude: Longitude.parse(longitude) };
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
  return { text: `INSERT INTO ${table} (${columns.join(", ")}) VALUES ${groups.join(", ")}`, values: rows.flatMap((row) => [...row]) };
}

export function workInsert(seeds: readonly WorkSeed[]): SeedStatement {
  return statement("bangumi", ["id", "title"], seeds.map((s) => [s.workId, s.title]));
}

/**
 * Points, written through their source geometry.
 *
 * `latitude` / `longitude` are NOT written directly: the Prisma data plane makes
 * them generated columns over `location` (#1626, spec §4.8.1), so a scalar write
 * is `cannot insert a non-DEFAULT value into column "latitude"` (`428C9`), and
 * `location` is the column spatial search reads anyway.
 */
export function pointInsert(seeds: readonly PointSeed[]): SeedStatement {
  const values = seeds.map((s): (string | number)[] => [s.id, s.workId, s.name, s.longitude, s.latitude]);
  return {
    text: "INSERT INTO points (id, bangumi_id, name, location)"
      + ` VALUES ${values.map((_, index) => pointGroup(index)).join(", ")}`,
    values: values.flatMap((row) => [...row]),
  };
}

/** Placeholders one point row binds: id, work, name, longitude, latitude. */
const POINT_SLOTS = 5;

/** One point row's placeholder group: three scalars, then the geometry over the
 * longitude/latitude pair that follows them. */
function pointGroup(index: number): string {
  const slot = (offset: number): string => `$${String(index * POINT_SLOTS + offset)}`;
  const scalars = [1, 2, 3].map((offset) => slot(offset)).join(", ");
  return `(${scalars}, ST_SetSRID(ST_MakePoint(${slot(4)}, ${slot(5)}), 4326)::geography)`;
}

export function aliasInsert(seeds: readonly AliasSeed[]): SeedStatement {
  return statement(
    "aliases",
    ["bangumi_id", "alias", "alias_normalized", "source", "priority"],
    seeds.map((s) => [s.workId, s.alias, s.normalized, s.source, s.priority]),
  );
}
