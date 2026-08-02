import {
  customType,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/** PostGIS geography typing for the legacy route origin column. */
const geography = customType<{ data: string; driverData: string }>({
  dataType() {
    return "geography(Point,4326)";
  },
});

/**
 * Typing only — queries go through the raw sql tagged template (workerd
 * gotcha). The Atlas SQL files under db/migrations are authoritative; this
 * schema never generates or applies migrations.
 */
export const routes = pgTable("routes", {
  id: uuid("id").primaryKey().defaultRandom(),
  sessionId: text("session_id"),
  bangumiId: text("bangumi_id"),
  originStation: text("origin_station"),
  originLocation: geography("origin_location"),
  pointIds: text("point_ids").array().notNull(),
  totalDistance: real("total_distance"),
  totalDuration: integer("total_duration"),
  routeData: jsonb("route_data"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  userId: text("user_id"),
  title: text("title"),
  status: text("status").notNull().default("draft"),
  savedAt: timestamp("saved_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
