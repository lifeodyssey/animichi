import type {
  ClaimRoutesInput,
  ClaimRoutesResult,
  DeleteRouteInput,
  DeleteRouteResult,
  ListRoutesResult,
  RouteStatus,
  SaveRouteInput,
  UserRoute,
} from "@seichijunrei/contract";
import { sql } from "drizzle-orm";
import type { DbExecutor } from "../db/client";
import { routeNotFound, routeNotOwned } from "../lib/errors";

type RecordRow = Record<string, unknown>;

function isRecord(value: unknown): value is RecordRow {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStatus(value: unknown): value is RouteStatus {
  return value === "draft" || value === "saved" || value === "completed";
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

/** Narrow and normalize one raw database row into the public route model. */
function toUserRoute(value: unknown): UserRoute {
  if (!isRecord(value)) throw new Error("invalid route row");
  const { id, title, status } = value;
  if (typeof id !== "string" || !isStatus(status)) {
    throw new Error("invalid route row");
  }
  const safeTitle = typeof title === "string" ? title : "";
  return {
    id, title: safeTitle, status, point_ids: strings(value.point_ids),
    saved_at: nullableIso(value.saved_at), updated_at: iso(value.updated_at),
  };
}

/** List routes owned by a user, newest update first. */
export async function listRoutes(db: DbExecutor, userId: string): Promise<ListRoutesResult> {
  const result = await db.execute(sql`
    SELECT id, title, point_ids, status, saved_at, updated_at
    FROM routes WHERE user_id = ${userId} ORDER BY updated_at DESC
  `);
  return { routes: result.rows.map(toUserRoute) };
}

async function createRoute(
  db: DbExecutor,
  userId: string,
  input: SaveRouteInput,
): Promise<UserRoute> {
  const result = await db.execute(sql`
    INSERT INTO routes (user_id, title, point_ids, status, saved_at)
    VALUES (${userId}, ${input.title}, ${sql.param(input.point_ids)}::text[], ${input.status},
      CASE WHEN ${input.status} = 'draft' THEN NULL ELSE NOW() END)
    RETURNING id, title, point_ids, status, saved_at, updated_at
  `);
  return toUserRoute(result.rows[0]);
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
  if (ownerFrom(result.rows[0]) !== userId) throw routeNotOwned(routeId);
}

function updatedRoute(rows: unknown[], routeId: string): UserRoute {
  if (rows.length === 0) throw routeNotOwned(routeId);
  return toUserRoute(rows[0]);
}

async function updateRoute(
  db: DbExecutor,
  userId: string,
  input: SaveRouteInput & { id: string },
): Promise<UserRoute> {
  await assertOwner(db, userId, input.id);
  const result = await db.execute(sql`
    UPDATE routes SET title = ${input.title}, point_ids = ${sql.param(input.point_ids)}::text[],
      status = ${input.status}, saved_at = CASE WHEN ${input.status} = 'draft'
        THEN NULL ELSE COALESCE(saved_at, NOW()) END
    WHERE id = ${input.id} AND user_id = ${userId}
    RETURNING id, title, point_ids, status, saved_at, updated_at
  `);
  return updatedRoute(result.rows, input.id);
}

/** Create a route or update it after explicit ownership validation. */
export async function saveRoute(
  db: DbExecutor,
  userId: string,
  input: SaveRouteInput,
): Promise<UserRoute> {
  return input.id
    ? updateRoute(db, userId, { ...input, id: input.id })
    : createRoute(db, userId, input);
}

/** Delete a route after explicit ownership validation. */
export async function deleteRoute(
  db: DbExecutor,
  userId: string,
  input: DeleteRouteInput,
): Promise<DeleteRouteResult> {
  await assertOwner(db, userId, input.id);
  const result = await db.execute(sql`
    DELETE FROM routes WHERE id = ${input.id} AND user_id = ${userId} RETURNING id
  `);
  if (result.rows.length === 0) throw routeNotOwned(input.id);
  return { deleted: true };
}

/** Atomically assign this session's still-anonymous routes to the caller. */
export async function claimRoutes(
  db: DbExecutor,
  userId: string,
  input: ClaimRoutesInput,
): Promise<ClaimRoutesResult> {
  const result = await db.execute(sql`
    UPDATE routes SET user_id = ${userId}
    WHERE session_id = ${input.session_id} AND user_id IS NULL RETURNING id
  `);
  return { claimed_count: result.rows.length };
}
