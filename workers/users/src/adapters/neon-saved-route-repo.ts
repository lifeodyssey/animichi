import type {
  ClaimRoutesInput,
  ClaimRoutesResult,
  DeleteRouteInput,
  DeleteRouteResult,
  ListRoutesResult,
  RouteStatus,
  SaveRouteInput,
  UserRoute,
} from "@animichi/contract";
import { sql } from "drizzle-orm";
import type { DbExecutor } from "../db/client";
import {
  assertRouteOwnedBy,
  isRouteStatus,
  RouteNotOwnedError,
  savedAtPolicy,
} from "../domain/route-rules";
import type { SavedRouteRepo } from "../domain/ports";
import { routeNotFound, routeNotOwned } from "../lib/errors";

type RecordRow = Record<string, unknown>;

function isRecord(value: unknown): value is RecordRow {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function strings(value: unknown): string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : [];
}

function iso(value: unknown): string {
  if (typeof value !== "string" && !(value instanceof Date)) throw new Error("invalid timestamp row");
  return new Date(value).toISOString();
}

function nullableIso(value: unknown): string | null {
  return value === null ? null : iso(value);
}

function requireRouteRow(value: RecordRow): { id: string; title: unknown; status: RouteStatus } {
  const { id, title, status } = value;
  if (typeof id !== "string" || !isRouteStatus(status)) {
    throw new Error("invalid route row");
  }
  return { id, title, status };
}

/** Narrow and normalize one raw database row into the public route model. */
function toUserRoute(value: unknown): UserRoute {
  if (!isRecord(value)) throw new Error("invalid route row");
  const { id, title, status } = requireRouteRow(value);
  const safeTitle = typeof title === "string" ? title : "";
  return {
    id, title: safeTitle, status, point_ids: strings(value.point_ids),
    saved_at: nullableIso(value.saved_at), updated_at: iso(value.updated_at),
  };
}

function ownerFrom(value: unknown): string | null | undefined {
  if (!isRecord(value)) return undefined;
  return typeof value.user_id === "string" || value.user_id === null
    ? value.user_id
    : undefined;
}

async function assertOwner(db: DbExecutor, userId: string, routeId: string): Promise<void> {
  const result = await db.execute(sql`SELECT user_id FROM routes WHERE id = ${routeId}`);
  if (result.rows.length === 0) throw routeNotFound(routeId);
  try {
    assertRouteOwnedBy(ownerFrom(result.rows[0]), userId, routeId);
  } catch (error) {
    if (error instanceof RouteNotOwnedError) throw routeNotOwned(routeId);
    throw error;
  }
}

function insertRouteSql(userId: string, input: SaveRouteInput) {
  return sql`
    INSERT INTO routes (user_id, title, point_ids, status, saved_at)
    VALUES (${userId}, ${input.title}, ${sql.param(input.point_ids)}::text[], ${input.status},
      CASE WHEN ${savedAtPolicy(input.status, "insert")} = 'null' THEN NULL ELSE NOW() END)
    RETURNING id, title, point_ids, status, saved_at, updated_at
  `;
}

async function insertRoute(
  db: DbExecutor, userId: string, input: SaveRouteInput,
): Promise<unknown[]> {
  const result = await db.execute(insertRouteSql(userId, input));
  return result.rows;
}

async function createRoute(
  db: DbExecutor,
  userId: string,
  input: SaveRouteInput,
): Promise<UserRoute> {
  return toUserRoute((await insertRoute(db, userId, input))[0]);
}

function updatedRoute(rows: unknown[], routeId: string): UserRoute {
  if (rows.length === 0) throw routeNotOwned(routeId);
  return toUserRoute(rows[0]);
}

function updateRouteSql(userId: string, input: SaveRouteInput & { id: string }) {
  return sql`
    UPDATE routes SET title = ${input.title}, point_ids = ${sql.param(input.point_ids)}::text[],
      status = ${input.status}, saved_at = CASE ${savedAtPolicy(input.status, "update")}
        WHEN 'null' THEN NULL ELSE COALESCE(saved_at, NOW()) END
    WHERE id = ${input.id} AND user_id = ${userId}
    RETURNING id, title, point_ids, status, saved_at, updated_at
  `;
}

async function updateRouteRow(
  db: DbExecutor, userId: string, input: SaveRouteInput & { id: string },
): Promise<unknown[]> {
  const result = await db.execute(updateRouteSql(userId, input));
  return result.rows;
}

async function updateRoute(
  db: DbExecutor,
  userId: string,
  input: SaveRouteInput & { id: string },
): Promise<UserRoute> {
  await assertOwner(db, userId, input.id);
  return updatedRoute(await updateRouteRow(db, userId, input), input.id);
}

async function deleteRouteRow(db: DbExecutor, userId: string, routeId: string): Promise<unknown[]> {
  const result = await db.execute(sql`
    DELETE FROM routes WHERE id = ${routeId} AND user_id = ${userId} RETURNING id
  `);
  return result.rows;
}

/** Atomic claim: only rows whose owner passes canClaimUnowned (user_id IS NULL,
 * src/domain/route-rules.ts) are touched — owned rows are left intact. */
async function claimRouteRows(db: DbExecutor, userId: string, sessionId: string): Promise<unknown[]> {
  const result = await db.execute(sql`
    UPDATE routes SET user_id = ${userId}
    WHERE session_id = ${sessionId} AND user_id IS NULL RETURNING id
  `);
  return result.rows;
}

/**
 * Neon-backed SavedRouteRepo over the raw SQL executor (Drizzle typing only,
 * see src/db/client.ts). Maps RouteNotOwnedError to the oRPC ROUTE_NOT_OWNED
 * error and a missing row to ROUTE_NOT_FOUND (src/lib/errors.ts).
 */
export class NeonSavedRouteRepo implements SavedRouteRepo {
  constructor(private readonly db: DbExecutor) {}

  async listRoutes(userId: string): Promise<ListRoutesResult> {
    const result = await this.db.execute(sql`
      SELECT id, title, point_ids, status, saved_at, updated_at
      FROM routes WHERE user_id = ${userId} ORDER BY updated_at DESC
    `);
    return { routes: result.rows.map(toUserRoute) };
  }

  async saveRoute(userId: string, input: SaveRouteInput): Promise<UserRoute> {
    return input.id
      ? updateRoute(this.db, userId, { ...input, id: input.id })
      : createRoute(this.db, userId, input);
  }

  async deleteRoute(userId: string, input: DeleteRouteInput): Promise<DeleteRouteResult> {
    await assertOwner(this.db, userId, input.id);
    if ((await deleteRouteRow(this.db, userId, input.id)).length === 0) {
      throw routeNotOwned(input.id);
    }
    return { deleted: true };
  }

  async claimRoutes(userId: string, input: ClaimRoutesInput): Promise<ClaimRoutesResult> {
    return { claimed_count: (await claimRouteRows(this.db, userId, input.session_id)).length };
  }
}
