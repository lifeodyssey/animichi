/**
 * Drizzle mapping for the Catalog service data plane.
 *
 * Mirrors the live Postgres schema exactly (migrations/neon/*). This is the
 * single source of table/column mappings under stories 7-9 of #992: reads and
 * writes are built with the Drizzle query builder so column checks happen in
 * TypeScript. Complete hand-written SQL lives nowhere outside the typed
 * expression helpers in `./expressions` (which return fragments only, never
 * complete statements).
 *
 * Runtime-only: this schema never generates or applies migrations. It is
 * query-only runtime metadata for the Drizzle query builder; Atlas migrations
 * (migrations/neon/*.sql) remain the sole DDL authority.
 *
 * - Geography (`points.location`, `locations.location`) is PostGIS
 *   GEOGRAPHY(Point,4326). Drizzle has no native geography column, so it is
 *   modelled via `customType`: the driver returns the EWKB hex string on read
 *   and accepts it on bind. Spatial predicates use `expressions` helpers.
 * - `points.embedding` is pgvector `vector(1024)`; likewise custom-typed.
 * - Animichi-owned entity ids are PostgreSQL UUID with a native `uuidv7()`
 *   default (the #992 identity cutover); external/provider ids stay text.
 */

import { sql } from "drizzle-orm";
import {
  bigserial, boolean, customType, doublePrecision, integer, jsonb, pgTable, real,
  text, timestamp, uuid,
} from "drizzle-orm/pg-core";

/** PostGIS GEOGRAPHY(Point,4326): EWKB hex string at the driver boundary. */
const geography = customType<{ data: string; driverData: string }>({
  dataType() {
    return "geography(Point,4326)";
  },
});

/** pgvector `vector(dimensions)`: the Catalog read path selects it only when asked. */
const vectorDim = (dimensions: number) =>
  customType<{ data: number[]; driverData: string }>({
    dataType() {
      return "vector(" + String(dimensions) + ")";
    },
    toDriver(value: number[]) {
      return `[${value.join(",")}]`;
    },
    fromDriver(value: string) {
      return value
        .slice(1, -1)
        .split(",")
        .filter((part) => part.length > 0)
        .map(Number);
    },
  });

// 20260826000003_catalog.sql — anime metadata.
export const bangumi = pgTable("bangumi", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  titleCn: text("title_cn"),
  coverUrl: text("cover_url"),
  airDate: text("air_date"),
  summary: text("summary"),
  epsCount: integer("eps_count"),
  rating: real("rating"),
  pointsCount: integer("points_count").default(0),
  primaryColor: text("primary_color"),
  city: text("city"),
  platform: text("platform"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

// 20260826000003_catalog.sql — pilgrimage points with geo coordinates.
export const points = pgTable("points", {
  id: text("id").primaryKey(),
  bangumiId: text("bangumi_id").references(() => bangumi.id),
  name: text("name").notNull(),
  nameCn: text("name_cn"),
  latitude: doublePrecision("latitude").notNull(),
  longitude: doublePrecision("longitude").notNull(),
  location: geography("location"),
  image: text("image"),
  episode: integer("episode"),
  timeSeconds: integer("time_seconds").default(0),
  sceneDesc: text("scene_desc"),
  embedding: vectorDim(1024)("embedding"),
  origin: text("origin"),
  originUrl: text("origin_url"),
  city: text("city"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

// 20260826000003_catalog.sql — atomic blue/green version pointer.
export const clusterVersion = pgTable("cluster_version", {
  id: uuid("id").default(sql`uuidv7()`).primaryKey(),
  bangumiId: text("bangumi_id").notNull(),
  version: integer("version").notNull(),
  isCurrent: boolean("is_current").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// 20260826000003_catalog.sql — alias pipeline (NFKC-folded exact match).
export const aliases = pgTable("aliases", {
  id: uuid("id").default(sql`uuidv7()`).primaryKey(),
  bangumiId: text("bangumi_id").notNull(),
  alias: text("alias").notNull(),
  aliasNormalized: text("alias_normalized").notNull(),
  source: text("source").notNull(),
  priority: integer("priority").notNull().default(0),
});

// 20260826000003_catalog.sql — series relation graph.
export const seriesEdges = pgTable("series_edges", {
  fromBangumiId: text("from_bangumi_id").notNull(),
  toBangumiId: text("to_bangumi_id").notNull(),
  relation: text("relation").notNull(),
});

// 20260826000003_catalog.sql — immutable version-bound snapshots.
export const itinerarySnapshots = pgTable("itinerary_snapshots", {
  id: uuid("id").default(sql`uuidv7()`).primaryKey(),
  bangumiId: text("bangumi_id").notNull(),
  clusterVersion: integer("cluster_version").notNull(),
  payload: jsonb("payload").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// 20260826000003_catalog.sql — singleflight work tracking.
export const ingestJobs = pgTable("ingest_jobs", {
  workId: text("work_id").primaryKey(),
  status: text("status").notNull().default("pending"),
  stage: text("stage"),
  error: text("error"),
  errorCode: text("error_code"),
  negativeCachedUntil: timestamp("negative_cached_until", { withTimezone: true }),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// 20260826000003_catalog.sql — transit leg cache.
export const legCache = pgTable("leg_cache", {
  fromCluster: text("from_cluster").notNull(),
  toCluster: text("to_cluster").notNull(),
  mode: text("mode").notNull(),
  durationMinutes: doublePrecision("duration_minutes"),
  distanceM: doublePrecision("distance_m"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// 20260826000003_catalog.sql — media asset registry.
export const mediaAssets = pgTable("media_assets", {
  pointId: text("point_id").primaryKey(),
  r2Key: text("r2_key"),
  contentHash: text("content_hash"),
  lastOriginPull: timestamp("last_origin_pull", { withTimezone: true }),
  tombstoned: boolean("tombstoned").notNull().default(false),
});

// 20260826000003_catalog.sql — raw Anitabi payloads.
export const rawAnitabi = pgTable("raw_anitabi", {
  workId: text("work_id").primaryKey(),
  payload: jsonb("payload").notNull(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).defaultNow().notNull(),
});

// 20260826000003_catalog.sql — raw Bangumi payloads.
export const rawBangumi = pgTable("raw_bangumi", {
  workId: text("work_id").primaryKey(),
  payload: jsonb("payload").notNull(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).defaultNow().notNull(),
});

// 20260826000003_catalog.sql — gazetteer locations with geo.
export const locations = pgTable("locations", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  kind: text("kind").notNull(),
  latitude: doublePrecision("latitude").notNull(),
  longitude: doublePrecision("longitude").notNull(),
  location: geography("location"),
  source: text("source").notNull(),
  pref: text("pref"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

// 20260826000003_catalog.sql — gazetteer alias index.
export const locationAliases = pgTable("location_aliases", {
  alias: text("alias").notNull(),
  aliasNormalized: text("alias_normalized").notNull(),
  locationId: text("location_id").notNull().references(() => locations.id),
  lang: text("lang"),
  priority: integer("priority").notNull().default(0),
});

// 20260826000005_users.sql — route → work membership.
export const savedRouteAnime = pgTable("saved_route_anime", {
  savedRouteId: uuid("saved_route_id").notNull(),
  bangumiId: text("bangumi_id").notNull().references(() => bangumi.id),
  position: integer("position").notNull().default(0),
});

// 20260812000000_catalog_daily_run.sql — durable daily discovery/ingest run (AC1).
export const catalogRuns = pgTable("catalog_runs", {
  runId: text("run_id").primaryKey(),
  status: text("status").notNull().default("pending"),
  targets: jsonb("targets"),
  sourceOutcomes: jsonb("source_outcomes"),
  budgetUsed: jsonb("budget_used"),
  failures: jsonb("failures"),
  publishedVersions: jsonb("published_versions"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// 20260812000000_catalog_daily_run.sql — latest+previous raw payload history (AC5).
export const rawPayloadHistory = pgTable("raw_payload_history", {
  seq: bigserial("seq", { mode: "number" }).primaryKey(),
  workId: text("work_id").notNull(),
  source: text("source").notNull(),
  payload: jsonb("payload").notNull(),
  runId: text("run_id"),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).defaultNow().notNull(),
});

// 20260812000000_catalog_daily_run.sql — provenance/attribution/source-map (AC4).
export const catalogProvenance = pgTable("catalog_provenance", {
  id: uuid("id").default(sql`uuidv7()`).primaryKey(),
  scope: text("scope").notNull(),
  entityId: text("entity_id").notNull(),
  workId: text("work_id"),
  source: text("source").notNull(),
  upstreamId: text("upstream_id"),
  attribution: text("attribution"),
  license: text("license"),
  fieldMap: jsonb("field_map"),
  capturedAt: timestamp("captured_at", { withTimezone: true }).defaultNow().notNull(),
});
