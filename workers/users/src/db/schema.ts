import { sql } from "drizzle-orm";
import {
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Drizzle mapping for the saved-routes table. Mirrors the live Atlas schema
 * (migrations/neon, see migrations/AGENTS.md): Animichi-owned ids are
 * PostgreSQL UUID with a native `uuidv7()` DB default — the #992 identity
 * cutover (stories 17/18/22). The builder omits `id` so the DB default
 * applies; `defaultRandom()` would force client-side UUIDv4 and is banned
 * here. This schema never generates or applies migrations — the Atlas SQL
 * files under migrations/neon are authoritative. It is query-only runtime
 * metadata for the Drizzle query builder, never a DDL authority.
 */
export const savedRoutes = pgTable("saved_routes", {
  id: uuid("id").default(sql`uuidv7()`).primaryKey(),
  pointIds: text("point_ids").array().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  userId: text("user_id"),
  title: text("title"),
  status: text("status").notNull().default("draft"),
  savedAt: timestamp("saved_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Drizzle mapping for the SavedRoute-create idempotency ledger (issue #1011).
 * One row per (owner_user_id, op, key): the durable record of a retry-safe
 * create, scoped by the authenticated owner + operation so two users sharing
 * one key string never collide and an operation's key never dedupes against
 * another's. state moves in_progress -> committed; result holds the committed
 * SavedRoute snapshot and result_id references it. expires_at bounds retention
 * so an expired key is deterministically reclaimable. Query-only metadata for
 * the Drizzle query builder — the Atlas SQL under migrations/neon is
 * authoritative.
 */
export const savedRouteIdempotency = pgTable("saved_route_idempotency", {
  ownerUserId: text("owner_user_id").notNull(),
  op: text("op").notNull(),
  key: text("key").notNull(),
  fingerprint: text("fingerprint").notNull(),
  state: text("state").notNull().default("in_progress"),
  result: jsonb("result"),
  resultId: uuid("result_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});
