/**
 * Daily discovery inventory builder (#1006 AC2).
 *
 * Produces the discovery inputs for a daily run from the catalog's current
 * state: the checked-in popular pilgrimage works (popularity), the works already
 * cataloged (historical), and an optional seasonal resolver (current_season,
 * wired to the Bangumi calendar by the caller / integration spike). Known ids
 * are read from the bangumi table so the bounded-growth cap in the run applies
 * to genuinely new works.
 */
import type { SQL } from "drizzle-orm";
import type { CatalogDb } from "../db/client";
import { statementBuilder } from "../db/client";
import { bangumi } from "../db/schema";
import { SEED_BANGUMI } from "./seed-works";
import { dailyRunKey, type DiscoveryInput } from "./discovery";
import type { TierName, TieredWork } from "./tiers";
import type { DailyRunInputs } from "./catalog-daily-run";

/** A seasonal resolver that returns the current season's bangumi ids. */
export type SeasonalResolver = () => Promise<readonly string[]>;

/** Build the daily run inventory: known ids, the three discovery inputs, tiers. */
export async function buildDailyInventory(
  db: CatalogDb,
  seasonalResolver: SeasonalResolver = () => Promise.resolve([]),
): Promise<DailyRunInputs> {
  const knownIds = await loadKnownIds(db);
  const seasonal = new Set(await seasonalResolver());
  const tiered = tierWorks(knownIds, seasonal);
  const discovery: readonly DiscoveryInput[] = [
    { source: "current_season", bangumiIds: [...seasonal] },
    { source: "popularity", bangumiIds: SEED_BANGUMI.map((work) => work.bangumiId) },
    { source: "historical", bangumiIds: [...knownIds] },
  ];
  return { discovery, knownIds, tiered };
}

/** All ids already present in the catalog. */
async function loadKnownIds(db: CatalogDb): Promise<ReadonlySet<string>> {
  const rows = (await db.execute(knownIdsStatement())).rows;
  return new Set(rows.flatMap(idOf));
}

/** The SELECT of all bangumi ids. */
function knownIdsStatement(): SQL {
  return statementBuilder().select({ id: bangumi.id }).from(bangumi).getSQL();
}

/** Coerce a result row to a string id, or none when malformed. */
function idOf(row: unknown): string[] {
  if (row === null || typeof row !== "object") return [];
  const id = (row as Record<string, unknown>).id;
  return typeof id === "string" ? [id] : [];
}

/** Assign a refresh tier to every known/seasonal work. */
function tierWorks(knownIds: ReadonlySet<string>, seasonal: ReadonlySet<string>): TieredWork[] {
  const result: TieredWork[] = [];
  for (const id of knownIds) {
    result.push({ bangumiId: id, tier: tierOf(id, seasonal), lastIngestedAtMs: null });
  }
  for (const id of seasonal) {
    if (!knownIds.has(id)) result.push({ bangumiId: id, tier: "high", lastIngestedAtMs: null });
  }
  return result;
}

/** Seasonal works refresh fastest; everything else is a slow historical sweep. */
function tierOf(id: string, seasonal: ReadonlySet<string>): TierName {
  return seasonal.has(id) ? "high" : "medium";
}

export { dailyRunKey };
