import type {
  ClaimSavedRoutesInput,
  ClaimSavedRoutesResult,
  DeleteSavedRouteInput,
  DeleteSavedRouteResult,
  ListSavedRoutesResult,
  SaveSavedRouteInput,
  SavedRoute,
  SavedRouteStatus,
} from "@animichi/contract";
import { sql } from "drizzle-orm";
import type { DbExecutor } from "../db/client";
import {
  assertSavedRouteOwnedBy,
  isSavedRouteStatus,
  savedAtPolicy,
} from "../domain/route-rules";
import type { SavedRouteRepo } from "../domain/ports";
import { savedRouteNotFound, savedRouteNotOwned } from "../lib/errors";

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

function requireSavedRouteRow(value: RecordRow): { id: string; title: unknown; status: SavedRouteStatus } {
  const { id, title, status } = value;
  if (typeof id !== "string" || !isSavedRouteStatus(status)) {
    throw new Error("invalid saved route row");
  }
  return { id, title, status };
}

/** Narrow and normalize one raw database row into the public saved-route model. */
function toSavedRoute(value: unknown): SavedRoute {
  if (!isRecord(value)) throw new Error("invalid saved route row");
  const { id, title, status } = requireSavedRouteRow(value);
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

async function assertOwner(db: DbExecutor, userId: string, savedRouteId: string): Promise<void> {
  const result = await db.execute(sql`SELECT user_id FROM saved_routes WHERE id = ${savedRouteId}`);
  if (result.rows.length === 0) throw savedRouteNotFound(savedRouteId);
  try {
    assertSavedRouteOwnedBy(ownerFrom(result.rows[0]), userId, savedRouteId);
  } catch {
    // assertSavedRouteOwnedBy's contract (src/domain/route-rules.ts) is to
    // throw only SavedRouteNotOwnedError on mismatch — the adapter translates
    // any such failure to the oRPC 403. The domain rule is pure and
    // unit-tested, so no unexpected error type is possible here.
    throw savedRouteNotOwned(savedRouteId);
  }
}

function insertSavedRouteSql(userId: string, input: SaveSavedRouteInput) {
  return sql`
    INSERT INTO saved_routes (user_id, title, point_ids, status, saved_at)
    VALUES (${userId}, ${input.title}, ${sql.param(input.point_ids)}::text[], ${input.status},
      CASE WHEN ${savedAtPolicy(input.status, "insert")} = 'null' THEN NULL ELSE NOW() END)
    RETURNING id, title, point_ids, status, saved_at, updated_at
  `;
}

async function insertSavedRoute(
  db: DbExecutor, userId: string, input: SaveSavedRouteInput,
): Promise<unknown[]> {
  const result = await db.execute(insertSavedRouteSql(userId, input));
  return result.rows;
}

async function createSavedRoute(
  db: DbExecutor,
  userId: string,
  input: SaveSavedRouteInput,
): Promise<SavedRoute> {
  return toSavedRoute((await insertSavedRoute(db, userId, input))[0]);
}

function updatedSavedRoute(rows: unknown[], savedRouteId: string): SavedRoute {
  if (rows.length === 0) throw savedRouteNotOwned(savedRouteId);
  return toSavedRoute(rows[0]);
}

function updateSavedRouteSql(userId: string, input: SaveSavedRouteInput & { id: string }) {
  return sql`
    UPDATE saved_routes SET title = ${input.title}, point_ids = ${sql.param(input.point_ids)}::text[],
      status = ${input.status}, saved_at = CASE ${savedAtPolicy(input.status, "update")}
        WHEN 'null' THEN NULL ELSE COALESCE(saved_at, NOW()) END
    WHERE id = ${input.id} AND user_id = ${userId}
    RETURNING id, title, point_ids, status, saved_at, updated_at
  `;
}

async function updateSavedRouteRow(
  db: DbExecutor, userId: string, input: SaveSavedRouteInput & { id: string },
): Promise<unknown[]> {
  const result = await db.execute(updateSavedRouteSql(userId, input));
  return result.rows;
}

async function updateSavedRoute(
  db: DbExecutor,
  userId: string,
  input: SaveSavedRouteInput & { id: string },
): Promise<SavedRoute> {
  await assertOwner(db, userId, input.id);
  return updatedSavedRoute(await updateSavedRouteRow(db, userId, input), input.id);
}

async function deleteSavedRouteRow(db: DbExecutor, userId: string, savedRouteId: string): Promise<unknown[]> {
  const result = await db.execute(sql`
    DELETE FROM saved_routes WHERE id = ${savedRouteId} AND user_id = ${userId} RETURNING id
  `);
  return result.rows;
}

/** Atomic claim: only rows whose owner passes canClaimUnownedSavedRoute
 * (user_id IS NULL, src/domain/route-rules.ts) are touched — owned rows are
 * left intact. */
async function claimSavedRouteRows(db: DbExecutor, userId: string, sessionId: string): Promise<unknown[]> {
  const result = await db.execute(sql`
    UPDATE saved_routes SET user_id = ${userId}
    WHERE claim_session_id = ${sessionId} AND user_id IS NULL RETURNING id
  `);
  return result.rows;
}

/**
 * Neon-backed SavedRouteRepo over the raw SQL executor (Drizzle typing only,
 * see src/db/client.ts). Maps SavedRouteNotOwnedError to the oRPC
 * SAVED_ROUTE_NOT_OWNED error and a missing row to SAVED_ROUTE_NOT_FOUND
 * (src/lib/errors.ts).
 */
export class NeonSavedRouteRepo implements SavedRouteRepo {
  constructor(private readonly db: DbExecutor) {}

  async listSavedRoutes(userId: string): Promise<ListSavedRoutesResult> {
    const result = await this.db.execute(sql`
      SELECT id, title, point_ids, status, saved_at, updated_at
      FROM saved_routes WHERE user_id = ${userId} ORDER BY updated_at DESC
    `);
    return { saved_routes: result.rows.map(toSavedRoute) };
  }

  async saveSavedRoute(userId: string, input: SaveSavedRouteInput): Promise<SavedRoute> {
    return input.id
      ? updateSavedRoute(this.db, userId, { ...input, id: input.id })
      : createSavedRoute(this.db, userId, input);
  }

  async deleteSavedRoute(userId: string, input: DeleteSavedRouteInput): Promise<DeleteSavedRouteResult> {
    await assertOwner(this.db, userId, input.id);
    if ((await deleteSavedRouteRow(this.db, userId, input.id)).length === 0) {
      throw savedRouteNotOwned(input.id);
    }
    return { deleted: true };
  }

  async claimSavedRoutes(userId: string, input: ClaimSavedRoutesInput): Promise<ClaimSavedRoutesResult> {
    return { claimed_count: (await claimSavedRouteRows(this.db, userId, input.session_id)).length };
  }
}
