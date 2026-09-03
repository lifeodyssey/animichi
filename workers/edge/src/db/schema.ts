/**
 * Drizzle mapping for the agent turn tables the edge owns from W1 on
 * (spec `docs/specs/2026-09-01-agent-ts-rewrite-spec.md` §二/§三, issue #1250):
 * `messages` (the transcript plus the intake dedupe key), `runs` (one row per
 * agent turn — status, lease, quota reservation, usage settlement) and
 * `run_steps` (one row per tool step, the alarm-retry replay log), plus
 * `anon_daily_message_count`, the counter the intake reserves in that same
 * transaction (#1251).
 *
 * Runtime-only: this file never generates or applies migrations. It is
 * query-only runtime metadata for the Drizzle query builder; the Atlas SQL under
 * `migrations/neon` (`20260826000004_agent.sql`, `20260902000000_agent_runs.sql`)
 * is the sole DDL authority. Column CHECK vocabularies are mirrored here as
 * Drizzle `enum` column options rather than as `check()` DDL, so the value domain
 * types the intake's inserts without this file restating a constraint expression
 * the database already owns; `test/agent-runs-schema.test.ts` proves the two
 * agree by parsing the migration.
 *
 * Animichi-owned ids are PostgreSQL UUID with a native `uuidv7()` default (#992);
 * `sessions.id` stays text (anonymous `anon_*` / Neon Auth subject). Under
 * workerd a `timestamptz` comes back as a raw string — normalise at the boundary
 * (`workers/users/AGENTS.md`).
 */

import { eq, isNotNull, sql } from "drizzle-orm";
import {
  bigint,
  date,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/** The two authors of a transcript row (`messages_role_check`). */
export const MESSAGE_ROLES = ["user", "assistant"] as const;

/** A turn's lifecycle states (`runs_status_check`). Terminal: all but `running`. */
export const RUN_STATUSES = ["running", "succeeded", "failed"] as const;

/** Who pays for a turn (`runs_payer_check`); mirrors `daily_usage.scope`. */
export const RUN_PAYERS = ["anon", "user", "byok"] as const;

/** One value of that domain — the type an intake carries before it is a row. */
export type RunPayer = (typeof RUN_PAYERS)[number];

/**
 * Why a turn ended `failed` (`runs_failure_reason_check`). `lease_expired` and
 * `deadline_exceeded` are the reclaim scan's two verdicts; the rest are the
 * writer's own. Bounded because the reason reaches the client through
 * `GET /v1/conversations/:id/messages` and must not leak internals.
 */
export const RUN_FAILURE_REASONS = [
  "lease_expired",
  "deadline_exceeded",
  "provider_failed",
  "tool_failed",
  "cancelled",
  "internal_error",
] as const;

/** One value of that domain — the reason a settlement carries before it is a row. */
export type RunFailureReason = (typeof RUN_FAILURE_REASONS)[number];

/**
 * The dialogue transcript. `clientMessageId` is the intake dedupe key: a
 * replayed `POST /v1/chat` must resolve to the message already stored rather
 * than append a second one. It is nullable because every row written before
 * `20260902000000_agent_runs.sql` has none, so the uniqueness is partial.
 */
export const messages = pgTable(
  "messages",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    sessionId: text("session_id").notNull(),
    role: text("role", { enum: MESSAGE_ROLES }).notNull(),
    content: text("content").notNull(),
    responseData: jsonb("response_data"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    clientMessageId: text("client_message_id"),
  },
  (table) => [
    uniqueIndex("messages_session_client_message_id")
      .on(table.sessionId, table.clientMessageId)
      .where(isNotNull(table.clientMessageId)),
  ],
);

/**
 * One row per agent turn.
 *
 * Lease: `leaseOwner` is the DO incarnation holding the single-writer turn
 * lease and `leaseExpiresAt` its renewable slice. They are a pair or neither
 * (`runs_lease_held_check`): a run the intake committed but never armed with
 * `setAlarm` has no lease at all, which is the "never taken" case the singleton
 * RunSweeper DO looks for alongside the expired ones. `deadlineAt` is the
 * non-renewable whole-turn budget and `runs_lease_within_deadline_check` caps
 * every renewal at it, so the wedged-but-alive writer cannot renew its way out
 * of the sweep either; `idx_runs_sweep` serves all three cases.
 * Admission rides the same row: `runs_one_running_per_session` makes "one turn
 * at a time per session" a unique-key loss on INSERT rather than a
 * read-then-write race, mirroring what `turn_reservations` got from its
 * `(session_id, revision)` key.
 *
 * Quota reservation: the intake reserves in the same transaction as the message
 * and the run, and records the coordinates of what it reserved —
 * `quotaIdentityId` + `quotaUsageDate` name the exact
 * `anon_daily_message_count` row, so a turn that finishes after UTC midnight
 * still refunds the day it charged. Both are NULL together when the payer is
 * not metered. `quotaRefundedAt` is the durable exactly-once marker for the
 * refund itself.
 *
 * Usage settlement lives in columns, not a foreign key: the existing usage
 * tables are day aggregates keyed by `(usage_date, scope)` and
 * `(usage_date, anon_id)`, so there is no per-turn row for a run to point at.
 * The counters mirror `daily_usage`'s types exactly, and `usageSettledAt` marks
 * the run whose numbers were already rolled into that aggregate.
 */
export const runs = pgTable(
  "runs",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    sessionId: text("session_id").notNull(),
    messageId: uuid("message_id").notNull(),
    status: text("status", { enum: RUN_STATUSES }).notNull().default("running"),
    failureReason: text("failure_reason", { enum: RUN_FAILURE_REASONS }),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    deadlineAt: timestamp("deadline_at", { withTimezone: true }).notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    payer: text("payer", { enum: RUN_PAYERS }).notNull(),
    quotaIdentityId: text("quota_identity_id"),
    quotaUsageDate: date("quota_usage_date"),
    quotaRefundedAt: timestamp("quota_refunded_at", { withTimezone: true }),
    // Token counts stay JS numbers: a turn's tokens are orders of magnitude
    // below 2^53, and `bigint` mode would push a BigInt through every caller.
    inputTokens: bigint("input_tokens", { mode: "number" }).notNull().default(0),
    outputTokens: bigint("output_tokens", { mode: "number" }).notNull().default(0),
    // Money stays the driver's decimal string — never a float.
    costUsd: numeric("cost_usd", { precision: 14, scale: 6 }).notNull().default("0"),
    usageSettledAt: timestamp("usage_settled_at", { withTimezone: true }),
  },
  (table) => [
    unique("runs_message_id_key").on(table.messageId),
    // Admission: the intake's INSERT is the whole busy-session decision.
    uniqueIndex("runs_one_running_per_session")
      .on(table.sessionId)
      .where(eq(table.status, "running")),
  ],
);

/**
 * One row per tool step of one run. The loop persists a step's result BEFORE it
 * continues, so an alarm rerunning the same run after an eviction replays the
 * steps that already have one instead of calling the tool again (spec §三 "工具
 * 步骤幂等"). `(runId, stepIndex)` is both the primary key and the idempotency
 * key a side-effecting tool must accept; `result` and `finishedAt` appear
 * together (`run_steps_settled_check`), which is the "already done" predicate
 * the replay reads. `toolName` is an open domain on purpose — the tool registry
 * owns which tools exist, and the schema must not need a migration to add one.
 */
export const runSteps = pgTable(
  "run_steps",
  {
    runId: uuid("run_id").notNull(),
    stepIndex: integer("step_index").notNull(),
    toolName: text("tool_name").notNull(),
    input: jsonb("input").notNull(),
    result: jsonb("result"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [primaryKey({ columns: [table.runId, table.stepIndex] })],
);

/**
 * The scope-partitioned daily model-usage meter (issue #274 / S1.8), which the
 * AgentSession settles one succeeded turn into (#1255). A day aggregate keyed by
 * `(usage_date, scope)` with no surrogate id, exactly as
 * `20260826000004_agent.sql` declares it.
 *
 * `scope` is mapped on `RUN_PAYERS` rather than on a domain of its own because
 * it IS that domain: `daily_usage_scope_check` and `runs_payer_check` admit the
 * same three values, so a settled run's payer is a usage scope by construction
 * and nothing has to translate between them
 * (`test/agent-runs-schema.test.ts` holds the two CHECKs to it).
 */
export const dailyUsage = pgTable(
  "daily_usage",
  {
    usageDate: date("usage_date").notNull(),
    scope: text("scope", { enum: RUN_PAYERS }).notNull(),
    // Counts of a whole day for one scope: still orders of magnitude below
    // 2^53, so they stay JS numbers like the per-run counters.
    requests: bigint("requests", { mode: "number" }).notNull().default(0),
    inputTokens: bigint("input_tokens", { mode: "number" }).notNull().default(0),
    outputTokens: bigint("output_tokens", { mode: "number" }).notNull().default(0),
    costUsd: numeric("cost_usd", { precision: 14, scale: 6 }).notNull().default("0"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.usageDate, table.scope] })],
);

/**
 * The per-identity anonymous daily message counter (issue #282 / S1.10). Older
 * than the turn tables and keyed by a natural composite `(usage_date, anon_id)`
 * with no surrogate id, exactly as `20260826000004_agent.sql` declares it. The
 * intake reserves one message here inside the turn transaction and records the
 * row's coordinates on the run, so the refund can find it after UTC midnight.
 */
export const anonDailyMessageCount = pgTable(
  "anon_daily_message_count",
  {
    usageDate: date("usage_date").notNull(),
    anonId: text("anon_id").notNull(),
    // The column is `bigint`; a day's message count for one visitor is orders
    // of magnitude below 2^53, so it stays a JS number like the run counters.
    messageCount: bigint("message_count", { mode: "number" }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.usageDate, table.anonId] })],
);
