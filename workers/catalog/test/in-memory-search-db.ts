import type { MissPreview, SearchDb } from "../src/api/search";
import type { PublishedPointRow } from "../src/application/list-points-for-bangumi";
import type { CatalogDb } from "../src/db/client";

export const ROW: PublishedPointRow = {
  id: "spot-1",
  name: "鷲宮神社",
  name_cn: "鹫宫神社",
  bangumi_id: "1",
  episode: 3,
  time_seconds: 120,
  image: "https://image.anitabi.cn/p1.jpg",
  latitude: 36.1019,
  longitude: 139.6586,
  title: "らき☆すた",
  title_cn: "幸运星",
  cover_url: "https://image.anitabi.cn/cover1.jpg",
  city: "Kuki",
  synced_at: new Date("2026-06-20T00:00:00.000Z"),
};

/** Index of works keyed by normalized alias (the published catalog). */
export type AliasIndex = Record<string, { workId: string; rows: PublishedPointRow[] }>;

/** The miss-path stubs a test can wire: resolve a preview + run the full ingest. */
export interface MissStubs {
  resolvePreview?: (query: string) => Promise<MissPreview | null>;
  runFullIngest?: (workId: string) => Promise<void>;
}

/** What a `fakeDb` records, for assertions. */
export interface Recorder {
  db: SearchDb;
  lookups: string[];
  resolved: string[];
  ingested: string[];
}

/**
 * Build a typed `SearchDb` fake keyed by normalized alias, recording lookups,
 * preview-resolves, and full-ingest calls. The miss stubs default to a null
 * preview (unresolvable title) and a no-op ingest.
 */
export function fakeDb(aliasIndex: AliasIndex, miss: MissStubs = {}): Recorder {
  const lookups: string[] = [], resolved: string[] = [], ingested: string[] = [];
  const db: SearchDb = {
    bangumiIdForAlias: (alias) => Promise.resolve(recordLookup(lookups, aliasIndex, alias)),
    pointsForBangumi: (bangumiId) => Promise.resolve(pointsFor(aliasIndex, bangumiId)),
    resolvePreview: (query) => resolvePreview(miss, resolved, query),
    runFullIngest: (workId) => runFullIngest(miss, ingested, workId),
  };
  return { db, lookups, resolved, ingested };
}

function pointsFor(index: AliasIndex, workId: string): PublishedPointRow[] {
  return Object.values(index).find((e) => e.workId === workId)?.rows ?? [];
}

async function resolvePreview(miss: MissStubs, resolved: string[], query: string): Promise<MissPreview | null> {
  resolved.push(query);
  // `await` (not a bare return) so a stub's already-rejected promise gains a
  // handler synchronously — workerd reports dangling rejections as unhandled.
  return miss.resolvePreview ? await miss.resolvePreview(query) : null;
}

async function runFullIngest(miss: MissStubs, ingested: string[], workId: string): Promise<void> {
  if (miss.runFullIngest) await miss.runFullIngest(workId);
  ingested.push(workId);
}

/** Record + resolve an alias lookup against the in-memory index. */
export function recordLookup(lookups: string[], index: AliasIndex, alias: string): string | undefined {
  lookups.push(alias);
  return index[alias]?.workId;
}

/** A `waitUntil` spy that collects every scheduled promise for later awaiting. */
export function waitUntilSpy(): { waitUntil: (p: Promise<unknown>) => void; scheduled: Promise<unknown>[] } {
  const scheduled: Promise<unknown>[] = [];
  return { waitUntil: (p) => void scheduled.push(p), scheduled };
}

/** Fake production DB for searchDb() alias misses; casts stay at the boundary. */
export function catalogDb(rows: unknown[]): CatalogDb {
  return { execute: () => Promise.resolve({ rows }) } as unknown as CatalogDb;
}
