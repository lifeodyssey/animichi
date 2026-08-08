import {
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Typing only — queries go through the raw sql tagged template (workerd
 * gotcha). The Atlas SQL files under migrations/neon are authoritative; this
 * schema never generates or applies migrations.
 */
export const savedRoutes = pgTable("saved_routes", {
  id: uuid("id").primaryKey().defaultRandom(),
  claimSessionId: text("claim_session_id"),
  pointIds: text("point_ids").array().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  userId: text("user_id"),
  title: text("title"),
  status: text("status").notNull().default("draft"),
  savedAt: timestamp("saved_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
