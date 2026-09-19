/**
 * Neon-backed IdempotencyStore over the Prisma query builder + the request's
 * runtime. Every statement is owner-and-operation-scoped by the composite
 * primary key (owner_user_id, op, key), so concurrent claims collapse to one
 * winner and a different user's identical key string never collides (AC3/AC4).
 *
 * ## Why this is two statements where it used to be one upsert
 *
 * `claim` and `reclaim` were `INSERT … ON CONFLICT (owner, op, key) DO UPDATE
 * SET … WHERE <staleness>` with a RETURNING. Prisma 8's contract-bound builder
 * has no `onConflict` member at all, and its contract-free `insert-on-conflict`
 * AST (`DoUpdateSetConflictAction`) carries only a `set` — there is no `WHERE`
 * to hang the staleness predicate on. That is the one shape of this card that
 * does not translate, so it is restated rather than forced:
 *
 * - **claim** inserts and reads the composite key's unique violation as the
 *   conflict `ON CONFLICT DO NOTHING` used to report as zero rows.
 * - **reclaim** updates the row in place, and the predicate rides the UPDATE's
 *   own `WHERE` — which is what #1222 actually required. It was never about the
 *   upsert: the staleness test must be evaluated against the row AS IT STANDS,
 *   and `targetWhere` put it in the conflict target's index-predicate slot,
 *   where a non-partial primary key silently absorbed it and real Postgres then
 *   overwrote a committed row inside its retention window. `WHERE` on an UPDATE
 *   has that property by construction; the old SQL-text guard is replaced by
 *   the real-database assertion in `test/idempotency-ledger.integration.test.ts`.
 *
 * The lazily-live row is never touched: a committed row inside its retention
 * window fails both branches of the predicate, so the UPDATE matches nothing,
 * the read finds it, and the caller gets the retryable in-flight error — the
 * same outcome the upsert produced when its `DO UPDATE … WHERE` matched nothing.
 */
import { SavedRoute } from "@animichi/contract";
import type { SqlOrmPlan } from "@prisma/orm-postgres/relational-core/types";
import type { IdempotencyRow, IdempotencyStore } from "../application/save-saved-route-idempotent";
import type { UsersPrisma, UsersStatementBuilder } from "../db/prisma";
import { IDEMPOTENCY_EXECUTION_TIMEOUT_MS } from "../domain/saved-route-idempotency";
import { firstRow } from "./neon-saved-route-repo";

const IDEMPOTENCY_TABLE = "saved_route_idempotency";

/** Columns every idempotency read/returning path selects. */
const IDEMPOTENCY_COLUMNS = ["state", "fingerprint", "result", "created_at", "expires_at"] as const;

/** The row a plan resolves to, read back off the plan rather than re-declared. */
type RowOf<Plan> = Plan extends SqlOrmPlan<infer Row> ? Row : never;

/** Normalize a Postgres timestamptz (a Date under Node, text under workerd). */
function iso(value: Date | string): string {
  return new Date(value).toISOString();
}

function nullableIso(value: Date | string | null): string | null {
  return value === null ? null : iso(value);
}

/** The contract's own schema owns the snapshot's shape — jsonb carries none. */
function parseSavedRouteResult(value: unknown): SavedRoute | null {
  if (value === null || value === undefined) return null;
  const parsed = SavedRoute.safeParse(value);
  if (!parsed.success) throw new Error("invalid idempotency result row");
  return parsed.data;
}

/** `state` is a plain String in the contract; the CHECK constrains it to two. */
function ledgerState(value: string): "in_progress" | "committed" {
  return value === "committed" ? "committed" : "in_progress";
}

/** Normalize a typed ledger row to the action's model. */
function toRow(row: IdempotencyRowShape): IdempotencyRow {
  return {
    state: ledgerState(row.state),
    fingerprint: row.fingerprint,
    result: parseSavedRouteResult(row.result),
    createdAt: nullableIso(row.created_at),
    expiresAt: iso(row.expires_at),
  };
}

/** One composite-key-led SELECT. */
function selectPlan(builder: UsersStatementBuilder, key: IdempotencyKey) {
  return builder.public.saved_route_idempotency
    .select(...IDEMPOTENCY_COLUMNS)
    .where((fields, fns) => fns.eq(fields.owner_user_id, key.ownerUserId))
    .where((fields, fns) => fns.eq(fields.op, key.op))
    .where((fields, fns) => fns.eq(fields.key, key.key))
    .build();
}

/** The row type every idempotency read and RETURNING path yields. */
type IdempotencyRowShape = RowOf<ReturnType<typeof selectPlan>>;

/** One INSERT … RETURNING over the ledger. */
function insertPlan(builder: UsersStatementBuilder, values: Record<string, unknown>) {
  return builder.public.saved_route_idempotency
    .insert([values])
    .returning(...IDEMPOTENCY_COLUMNS)
    .build();
}

interface IdempotencyKey { ownerUserId: string; op: string; key: string }

interface ClaimParams extends IdempotencyKey {
  fingerprint: string; expiresAt: string;
}

interface ReclaimParams extends ClaimParams {
  /** The action's own clock (ms) — NOT re-derived from `expiresAt`, so the
   * staleness check below is independent of the retention constant. */
  now: number;
}

/**
 * The reclaim UPDATE: refresh the row as this caller's fresh claim, but only
 * where the EXISTING row is stale — either its own retention has elapsed (a
 * committed row is honored for IDEMPOTENCY_RETENTION_MS before it is
 * recyclable), or it is a non-committed claim whose in-flight liveness window
 * (IDEMPOTENCY_EXECUTION_TIMEOUT_MS) has lapsed.
 *
 * Comparing the row's own columns to `now` (rather than to the new `expiresAt`
 * the caller is about to write) is what keeps this non-tautological:
 * `row.expires_at <= row.expires_at + 24h` is always true regardless of the
 * row's state, which is the bug this replaces. It also makes the
 * winner-takes-all race resolve correctly — the UPDATE refreshes both
 * created_at and expires_at, so a second concurrent reclaimer re-evaluates the
 * predicate against the just-updated (now live-looking) row and loses.
 */
function reclaimPlan(builder: UsersStatementBuilder, params: ReclaimParams) {
  const now = new Date(params.now).toISOString();
  const staleBefore = new Date(params.now - IDEMPOTENCY_EXECUTION_TIMEOUT_MS).toISOString();
  return builder.public.saved_route_idempotency
    .update({
      fingerprint: params.fingerprint, result: null, result_id: null,
      created_at: now, expires_at: params.expiresAt, state: "in_progress",
    })
    .where((fields, fns) => fns.eq(fields.owner_user_id, params.ownerUserId))
    .where((fields, fns) => fns.eq(fields.op, params.op))
    .where((fields, fns) => fns.eq(fields.key, params.key))
    .where((fields, fns) => fns.or(
      fns.lte(fields.expires_at, now),
      fns.and(fns.ne(fields.state, "committed"), fns.lte(fields.created_at, staleBefore)),
    ))
    .returning(...IDEMPOTENCY_COLUMNS)
    .build();
}

/** The SQLSTATE and table a driver failure names. The runtime normalizes a
 * SQLSTATE failure into a `SqlQueryError` carrying `sqlState` / `table`, and
 * keeps the original `pg` error (`code` / `table`) as its `cause` — so both
 * shapes are read, and the walk is bounded rather than open-ended. */
function violationOf(error: unknown): { sqlState?: unknown; table?: unknown } {
  const node = error;
  if (typeof node !== "object" || node === null) return {};
  const candidate = node as { sqlState?: unknown; code?: unknown; table?: unknown; cause?: unknown };
  if (typeof candidate.sqlState === "string") return { sqlState: candidate.sqlState, table: candidate.table };
  if (typeof candidate.code === "string") return { sqlState: candidate.code, table: candidate.table };
  return candidate.cause === node ? {} : violationOf(candidate.cause);
}

/**
 * A Postgres unique violation on `table`. The ledger's composite primary key is
 * its only unique constraint, so a violation here means exactly one thing: the
 * key is already claimed.
 */
function isUniqueViolationOn(error: unknown, table: string): boolean {
  const violation = violationOf(error);
  return violation.sqlState === "23505" && violation.table === table;
}

/**
 * Neon-backed IdempotencyStore. `claim` is an INSERT whose composite-key
 * conflict reads as "already claimed"; `reclaim` updates a stale row in place.
 */
export class NeonIdempotencyStore implements IdempotencyStore {
  constructor(private readonly prisma: UsersPrisma) {}

  async claim(params: ClaimParams): Promise<{ kind: "claimed" } | { kind: "exists"; row: IdempotencyRow }> {
    return this.claimOrExisting(params, {
      owner_user_id: params.ownerUserId, op: params.op, key: params.key,
      fingerprint: params.fingerprint, result: null, result_id: null,
      expires_at: params.expiresAt,
    });
  }

  async reclaim(params: ReclaimParams): Promise<{ kind: "claimed" } | { kind: "exists"; row: IdempotencyRow }> {
    const reclaimed = await firstRow(this.prisma.executor, reclaimPlan(this.prisma.builder, params));
    if (reclaimed !== undefined) return { kind: "claimed" };
    const live = await this.existing(params);
    if (live !== undefined) return { kind: "exists", row: live };
    // The row is gone entirely (nothing in this service deletes ledger rows):
    // create it as this caller's fresh claim rather than reporting a conflict.
    return this.claimOrExisting(params, {
      owner_user_id: params.ownerUserId, op: params.op, key: params.key,
      fingerprint: params.fingerprint, result: null, result_id: null,
      created_at: new Date(params.now).toISOString(), expires_at: params.expiresAt,
    });
  }

  async read(params: IdempotencyKey): Promise<IdempotencyRow | undefined> {
    return this.existing(params);
  }

  /** INSERT the claim; the composite key's unique violation means it exists. */
  private async claimOrExisting(
    key: IdempotencyKey,
    values: Record<string, unknown>,
  ): Promise<{ kind: "claimed" } | { kind: "exists"; row: IdempotencyRow }> {
    if (await this.insertClaim(values)) return { kind: "claimed" };
    const row = await this.existing(key);
    return row === undefined ? { kind: "claimed" } : { kind: "exists", row };
  }

  /** True when this caller's INSERT is the one that created the row. */
  private async insertClaim(values: Record<string, unknown>): Promise<boolean> {
    try {
      return (await firstRow(this.prisma.executor, insertPlan(this.prisma.builder, values))) !== undefined;
    } catch (error) {
      if (isUniqueViolationOn(error, IDEMPOTENCY_TABLE)) return false;
      throw error;
    }
  }

  private async existing(key: IdempotencyKey): Promise<IdempotencyRow | undefined> {
    const row = await firstRow(this.prisma.executor, selectPlan(this.prisma.builder, key));
    return row === undefined ? undefined : toRow(row);
  }
}

export type { IdempotencyKey, IdempotencyRowShape };
