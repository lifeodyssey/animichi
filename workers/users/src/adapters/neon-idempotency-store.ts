import type { SavedRoute } from "@animichi/contract";
import { and, eq, lte, ne, or } from "drizzle-orm";
import type { IdempotencyRow, IdempotencyStore } from "../application/save-saved-route-idempotent";
import type { UsersDb } from "../db/client";
import { IDEMPOTENCY_EXECUTION_TIMEOUT_MS } from "../domain/saved-route-idempotency";
import { savedRouteIdempotency } from "../db/schema";

/** Narrow a jsonb result cell (object, or the string neon-http may return) to a SavedRoute. */
function toSavedRouteResult(value: unknown): SavedRoute | null {
  if (value === null || value === undefined) return null;
  const parsed: unknown = typeof value === "string" ? (JSON.parse(value) as unknown) : value;
  const id = typeof parsed === "object" && parsed !== null
    ? (parsed as Record<string, unknown>).id
    : undefined;
  if (typeof id !== "string") throw new Error("invalid idempotency result row");
  return parsed as SavedRoute;
}

function iso(value: unknown): string {
  return new Date(value instanceof Date ? value : String(value)).toISOString();
}

/** Normalize a raw idempotency row to the action's model. */
function toRow(value: Record<string, unknown>): IdempotencyRow {
  return {
    state: value.state === "committed" ? "committed" : "in_progress",
    fingerprint: typeof value.fingerprint === "string" ? value.fingerprint : "",
    result: toSavedRouteResult(value.result),
    createdAt: value.created_at === null || value.created_at === undefined ? null : iso(value.created_at),
    expiresAt: iso(value.expires_at),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function firstRow(result: { rows: unknown[] }): Record<string, unknown> | undefined {
  return (Array.isArray(result.rows) ? result.rows : []).find(isRecord);
}

/** Columns every idempotency read/returning path selects. */
function idempotencyReturning() {
  return {
    state: savedRouteIdempotency.state,
    fingerprint: savedRouteIdempotency.fingerprint,
    result: savedRouteIdempotency.result,
    createdAt: savedRouteIdempotency.createdAt,
    expiresAt: savedRouteIdempotency.expiresAt,
  };
}

interface ClaimParams {
  ownerUserId: string; op: string; key: string; fingerprint: string; expiresAt: string;
}

interface ReclaimParams extends ClaimParams {
  /** The action's own clock (ms) — NOT re-derived from `expiresAt`, so the
   * staleness check below is independent of the retention constant. */
  now: number;
}

/**
 * Neon-backed IdempotencyStore over the Drizzle query builder + UsersDb seam.
 * Every statement is owner-and-operation-scoped by the composite primary key
 * (owner_user_id, op, key), so concurrent claims collapse to one winner
 * (ON CONFLICT DO NOTHING) and a different user's identical key string never
 * collides (AC3/AC4).
 */
export class NeonIdempotencyStore implements IdempotencyStore {
  constructor(private readonly db: UsersDb) {}

  async claim(params: ClaimParams): Promise<{ kind: "claimed" } | { kind: "exists"; row: IdempotencyRow }> {
    const statement = this.db.insert(savedRouteIdempotency)
      .values({
        ownerUserId: params.ownerUserId, op: params.op, key: params.key,
        fingerprint: params.fingerprint, result: null, resultId: null,
        expiresAt: new Date(params.expiresAt),
      })
      .onConflictDoNothing()
      .returning(idempotencyReturning());
    const row = firstRow(await this.db.execute(statement));
    if (row !== undefined) return { kind: "claimed" };
    return (await this.existing(params.ownerUserId, params.op, params.key)) ?? { kind: "claimed" };
  }

  async commit(params: { ownerUserId: string; op: string; key: string; result: SavedRoute; }): Promise<void> {
    const statement = this.db.update(savedRouteIdempotency)
      .set({ state: "committed", result: params.result, resultId: params.result.id })
      .where(and(
        eq(savedRouteIdempotency.ownerUserId, params.ownerUserId),
        eq(savedRouteIdempotency.op, params.op),
        eq(savedRouteIdempotency.key, params.key),
      ));
    await this.db.execute(statement);
  }

  /**
   * Reclaim a row abandoned by a prior claimant. The row is only reclaimable
   * when the EXISTING row itself — not the caller's freshly computed new
   * expiresAt — is stale: either its own retention has elapsed (a committed
   * row is honored for IDEMPOTENCY_RETENTION_MS before it is recyclable), or
   * it is a non-committed claim whose in-flight liveness window
   * (IDEMPOTENCY_EXECUTION_TIMEOUT_MS) has lapsed. A committed row inside its
   * retention window matches neither branch and is never touched.
   *
   * Comparing the row's own columns to `now` (rather than to the new
   * expiresAt the caller is about to write) is what makes this predicate
   * non-tautological: `row.expires_at <= row.expires_at + 24h` is always
   * true regardless of the row's state, which is the bug this replaces. It
   * also makes the winner-takes-all race resolve correctly — the UPDATE
   * refreshes both created_at and expires_at, so a second concurrent
   * reclaimer re-evaluates the predicate against the just-updated (now
   * live-looking) row and loses.
   */
  async reclaim(params: ReclaimParams): Promise<{ kind: "claimed" } | { kind: "exists"; row: IdempotencyRow }> {
    const now = new Date(params.now);
    const staleBefore = new Date(params.now - IDEMPOTENCY_EXECUTION_TIMEOUT_MS);
    const statement = this.db.insert(savedRouteIdempotency)
      .values({
        ownerUserId: params.ownerUserId, op: params.op, key: params.key,
        fingerprint: params.fingerprint, result: null, resultId: null,
        createdAt: now, expiresAt: new Date(params.expiresAt),
      })
      .onConflictDoUpdate({
        target: [savedRouteIdempotency.ownerUserId, savedRouteIdempotency.op, savedRouteIdempotency.key],
        set: {
          fingerprint: params.fingerprint, result: null, resultId: null,
          createdAt: now, expiresAt: new Date(params.expiresAt), state: "in_progress",
        },
        targetWhere: or(
          lte(savedRouteIdempotency.expiresAt, now),
          and(
            ne(savedRouteIdempotency.state, "committed"),
            lte(savedRouteIdempotency.createdAt, staleBefore),
          ),
        ),
      })
      .returning(idempotencyReturning());
    const row = firstRow(await this.db.execute(statement));
    if (row !== undefined) return { kind: "claimed" };
    return (await this.existing(params.ownerUserId, params.op, params.key)) ?? { kind: "claimed" };
  }

  async read(params: { ownerUserId: string; op: string; key: string }): Promise<IdempotencyRow | undefined> {
    return (await this.existing(params.ownerUserId, params.op, params.key))?.row;
  }

  private async existing(
    ownerUserId: string, op: string, key: string,
  ): Promise<{ kind: "exists"; row: IdempotencyRow } | undefined> {
    const statement = this.db.select(idempotencyReturning()).from(savedRouteIdempotency).where(and(
      eq(savedRouteIdempotency.ownerUserId, ownerUserId),
      eq(savedRouteIdempotency.op, op),
      eq(savedRouteIdempotency.key, key),
    ));
    const row = firstRow(await this.db.execute(statement));
    return row === undefined ? undefined : { kind: "exists", row: toRow(row) };
  }
}
