import type {
  ClaimRoutesInput,
  ClaimRoutesResult,
  DeleteRouteInput,
  DeleteRouteResult,
  ListSessionsInput,
  ListSessionsResult,
  ListRoutesResult,
  RouteStatus,
  SaveRouteInput,
  UserRoute,
  UserSession,
} from "@animichi/contract";
import { sql, type SQL } from "drizzle-orm";
import type { DbExecutor } from "../db/client";
import {
  assertRouteOwnedBy,
  isRouteStatus,
  savedAtPolicy,
} from "../domain/route-rules";
import { routeNotFound, routeNotOwned } from "../lib/errors";

/** ListSessionsInput caps offset at 1000 (packages/contract users-contract.ts). */
const MAX_LIST_OFFSET = 1_000;

type RecordRow = Record<string, unknown>;
interface DbRows { rows: unknown[] }

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

function requireSessionRow(
  value: RecordRow,
): { session_id: string; first_query: string; title: unknown } {
  const { session_id, first_query, title } = value;
  if (typeof session_id !== "string" || typeof first_query !== "string") {
    throw new Error("invalid session row");
  }
  return { session_id, first_query, title };
}

function toSession(value: unknown): UserSession {
  if (!isRecord(value)) throw new Error("invalid session row");
  const { session_id, first_query, title } = requireSessionRow(value);
  return {
    session_id, title: typeof title === "string" ? title : null,
    first_query, created_at: iso(value.created_at), updated_at: iso(value.updated_at),
  };
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

/** next_offset must stay within ListSessionsInput's offset cap (packages/contract
 * users-contract.ts): a next_offset the contract would reject is worse than
 * ending pagination early. */
function sessionPage(
  result: DbRows,
  input: ListSessionsInput,
): { sessions: UserSession[]; next_offset: number | null } {
  const sessions = result.rows.slice(0, input.limit).map(toSession);
  const next = input.offset + input.limit;
  const hasMore = result.rows.length > input.limit && next <= MAX_LIST_OFFSET;
  return { sessions, next_offset: hasMore ? next : null };
}

/** List routes owned by a user, newest update first. */
export async function listRoutes(db: DbExecutor, userId: string): Promise<ListRoutesResult> {
  const result = await db.execute(sql`
    SELECT id, title, point_ids, status, saved_at, updated_at
    FROM routes WHERE user_id = ${userId} ORDER BY updated_at DESC
  `);
  return { routes: result.rows.map(toUserRoute) };
}

function sessionSql(userId: string, input: ListSessionsInput): SQL {
  return sql`
    SELECT session_id, title, first_query, created_at, updated_at
    FROM conversations WHERE user_id = ${userId}
    ORDER BY updated_at DESC, session_id DESC
    LIMIT ${input.limit + 1} OFFSET ${input.offset}
  `;
}

/** List conversation-backed sessions owned by a user, newest first. */
export async function listSessions(
  db: DbExecutor, userId: string, input: ListSessionsInput,
): Promise<ListSessionsResult> {
  const result = await db.execute(sessionSql(userId, input));
  return sessionPage(result, input);
}

function insertRouteSql(userId: string, input: SaveRouteInput): SQL {
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

function ownerFrom(value: unknown): string | null | undefined {
  if (!isRecord(value)) return undefined;
  return typeof value.user_id === "string" || value.user_id === null
    ? value.user_id
    : undefined;
}

async function assertOwner(db: DbExecutor, userId: string, routeId: string): Promise<void> {
  const result = await db.execute(sql`SELECT user_id FROM routes WHERE id = ${routeId}`);
  if (result.rows.length === 0) throw routeNotFound(routeId);
  assertRouteOwnedBy(ownerFrom(result.rows[0]), userId, routeId);
}

function updatedRoute(rows: unknown[], routeId: string): UserRoute {
  if (rows.length === 0) throw routeNotOwned(routeId);
  return toUserRoute(rows[0]);
}

function updateRouteSql(userId: string, input: SaveRouteInput & { id: string }): SQL {
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

async function deleteRouteRow(db: DbExecutor, userId: string, routeId: string): Promise<unknown[]> {
  const result = await db.execute(sql`
    DELETE FROM routes WHERE id = ${routeId} AND user_id = ${userId} RETURNING id
  `);
  return result.rows;
}

/** Delete a route after explicit ownership validation. */
export async function deleteRoute(
  db: DbExecutor,
  userId: string,
  input: DeleteRouteInput,
): Promise<DeleteRouteResult> {
  await assertOwner(db, userId, input.id);
  if ((await deleteRouteRow(db, userId, input.id)).length === 0) throw routeNotOwned(input.id);
  return { deleted: true };
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

/** Atomically assign this session's still-anonymous routes to the caller. */
export async function claimRoutes(
  db: DbExecutor,
  userId: string,
  input: ClaimRoutesInput,
): Promise<ClaimRoutesResult> {
  return { claimed_count: (await claimRouteRows(db, userId, input.session_id)).length };
}
