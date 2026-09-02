// W0-S4 spike (#1247): the one table the S4 store writes that
// `workers/edge/src/db/schema.ts` does not map yet.
//
// `runs.session_id` and `messages.session_id` are both FKs onto
// `public.sessions` (`migrations/neon/20260826000004_agent.sql`), so a spike
// that writes a run has to put the session row there first. Mapping it here
// rather than in `src/db/schema.ts` keeps the spike out of the production
// surface; W1's intake owns the session row for real and will move this.

import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id"),
  title: text("title"),
  firstQuery: text("first_query"),
  state: jsonb("state").notNull().default({}),
  lifecycle: text("lifecycle").default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
});
