import type { SavedRoute } from "@animichi/contract";
import { and, eq, lte } from "drizzle-orm";
import type { IdempotencyRow, IdempotencyStore } from "../application/save-saved-route-idempotent";
import type { UsersDb } from "../db/client";
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

  async reclaim(params: ClaimParams): Promise<{ kind: "claimed" } | { kind: "exists"; row: IdempotencyRow }> {
    const statement = this.db.insert(savedRouteIdempotency)
      .values({
        ownerUserId: params.ownerUserId, op: params.op, key: params.key,
        fingerprint: params.fingerprint, result: null, resultId: null,
        expiresAt: new Date(params.expiresAt),
      })
      .onConflictDoUpdate({
        target: [savedRouteIdempotency.ownerUserId, savedRouteIdempotency.op, savedRouteIdempotency.key],
        set: {
          fingerprint: params.fingerprint, result: null, resultId: null,
          expiresAt: new Date(params.expiresAt), state: "in_progress",
        },
        targetWhere: lte(savedRouteIdempotency.expiresAt, new Date(params.expiresAt)),
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
