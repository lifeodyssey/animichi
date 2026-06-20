import {
  boolean,
  customType,
  doublePrecision,
  integer,
  pgTable,
  real,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/**
 * Drizzle read/query schema for the Catalog service.
 *
 * Query-only: column names and types mirror the live Postgres schema exactly
 * (supabase/migrations/20260402120000_remote_schema.sql +
 * 20260620230000_ingest_infrastructure.sql). The pipeline cards own all
 * inserts/updates; nothing here exposes write helpers.
 *
 * `location` is PostGIS GEOGRAPHY(Point,4326). Drizzle has no native geography
 * column, so it is modelled via `customType`: the driver returns the EWKB hex
 * string on read and accepts it on bind. Spatial predicates (ST_DWithin /
 * ST_Distance) are expressed with raw `sql` at the call site — see the spike —
 * not through this column type.
 */
const geography = customType<{ data: string; driverData: string }>({
  dataType() {
    return "geography(Point,4326)";
  },
});

// 002_bangumi.sql — anime metadata.
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
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

// 003_points.sql — pilgrimage points with geo coordinates.
// `embedding vector(1024)` is intentionally omitted: pgvector has no Drizzle
// core type and the Catalog read path never selects it.
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
  origin: text("origin"),
  originUrl: text("origin_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

// 20260620230000 — atomic version pointer (blue/green publish).
export const clusterVersion = pgTable("cluster_version", {
  id: serial("id").primaryKey(),
  workId: text("work_id").notNull(),
  version: integer("version").notNull(),
  isCurrent: boolean("is_current").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// 20260620230000 — alias pipeline (NFKC-folded exact match via alias_normalized).
export const aliases = pgTable("aliases", {
  id: serial("id").primaryKey(),
  workId: text("work_id").notNull(),
  alias: text("alias").notNull(),
  aliasNormalized: text("alias_normalized").notNull(),
  source: text("source").notNull(),
  priority: integer("priority").notNull().default(0),
});

// 20260620230000 — series relation graph for series-aware resolve.
export const seriesEdges = pgTable("series_edges", {
  fromWorkId: text("from_work_id").notNull(),
  toWorkId: text("to_work_id").notNull(),
  relation: text("relation").notNull(),
});

// 20260620230000 — walk-leg duration/distance cache (ORS -> Google).
export const legCache = pgTable("leg_cache", {
  fromCluster: text("from_cluster").notNull(),
  toCluster: text("to_cluster").notNull(),
  mode: text("mode").notNull(),
  durationMinutes: doublePrecision("duration_minutes"),
  distanceM: doublePrecision("distance_m"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
