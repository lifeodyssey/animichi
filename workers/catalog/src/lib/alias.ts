/**
 * Alias normalization + multi-source priority ranking.
 *
 * Feeds the `aliases` catalog table
 * (`db/migrations/20260623000001_init.sql`):
 *   work_id, alias, alias_normalized, source, priority.
 *
 * `alias_normalized` is the NFKC-folded form used for exact-match lookup
 * (btree `idx_aliases_normalized`); fuzzy match (pg_trgm) lands in Wave 2.
 *
 * Source priority follows `docs/superpowers/specs/2026-06-13-backend-design.md`
 * (line 38): Bangumi 官方名 (most authoritative) > AniDB daily dump >
 * 萌娘百科 (Moegirl) community names > manual seed (gap-filler fallback).
 * Higher number wins. (Anitabi supplies point data, not title aliases, so it is
 * not an alias source.)
 */

/** Alias provenance. Const object instead of bare strings. */
export const Source = {
  Bangumi: "bangumi",
  AniDB: "anidb",
  Moegirl: "moegirl",
  Manual: "manual",
} as const;

export type Source = (typeof Source)[keyof typeof Source];

/** Insert priority per source. Higher = more authoritative; survives dedup. */
export const SOURCE_PRIORITY: Readonly<Record<Source, number>> = {
  [Source.Bangumi]: 40,
  [Source.AniDB]: 30,
  [Source.Moegirl]: 20,
  [Source.Manual]: 10,
};

/** Raw alias as collected from a source, before normalization. */
export interface RawAlias {
  alias: string;
  source: Source;
}

/** Ranked alias row, ready for insert into the `aliases` table. */
export interface RankedAlias {
  alias: string;
  alias_normalized: string;
  source: Source;
  priority: number;
}

/**
 * NFKC fold + lowercase + trim + collapse internal whitespace.
 * Full-width and katakana variants fold to their canonical form so that
 * "ＦＡＴＥ" and "fate" share one `alias_normalized` key.
 */
export function normalizeAlias(raw: string): string {
  return raw.normalize("NFKC").toLowerCase().trim().replace(/\s+/gu, " ");
}

/**
 * Dedup by normalized form, keeping the highest-priority source.
 * Output is ready for insert (one row per distinct normalized alias).
 */
export function rankAliases(aliases: RawAlias[]): RankedAlias[] {
  const best = new Map<string, RankedAlias>();
  for (const raw of aliases) {
    consider(best, raw);
  }
  return [...best.values()];
}

/** Keep `raw` only if it beats the incumbent for its normalized key. */
function consider(best: Map<string, RankedAlias>, raw: RawAlias): void {
  const normalized = normalizeAlias(raw.alias);
  if (!normalized) {
    return;
  }
  const priority = SOURCE_PRIORITY[raw.source];
  const incumbent = best.get(normalized);
  if (!incumbent || priority > incumbent.priority) {
    best.set(normalized, toRow(raw, normalized, priority));
  }
}

/** Build the insert-ready row. */
function toRow(raw: RawAlias, normalized: string, priority: number): RankedAlias {
  return { alias: raw.alias, alias_normalized: normalized, source: raw.source, priority };
}
