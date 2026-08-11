import type {
  ClaimSavedRoutesInput,
  ClaimSavedRoutesResult,
  ListSavedRoutesResult,
  SaveSavedRouteInput,
  SavedRoute,
  SavedRouteStatus,
} from "@animichi/contract";
import { sql } from "drizzle-orm";
import type { DeleteOwnedOutcome, DeleteSavedRouteStore } from "../application/delete-saved-route";
import type { SavedRouteStore } from "../application/save-saved-route";
import type { DbExecutor } from "../db/client";
import type { OwnerLookup } from "../domain/ownership";
import type { SavedRouteRepo } from "../domain/ports";
import { isSavedRouteStatus } from "../domain/saved-route-status";

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

function insertSavedRouteSql(userId: string, input: SaveSavedRouteInput, savedAt: string | null) {
  return sql`
    INSERT INTO saved_routes (user_id, title, point_ids, status, saved_at)
    VALUES (${userId}, ${input.title}, ${sql.param(input.point_ids)}::text[], ${input.status}, ${savedAt})
    RETURNING id, title, point_ids, status, saved_at, updated_at
  `;
}

function updateSavedRouteSql(userId: string, input: SaveSavedRouteInput & { id: string }, savedAt: string | null) {
  return sql`
    UPDATE saved_routes SET title = ${input.title}, point_ids = ${sql.param(input.point_ids)}::text[],
      status = ${input.status}, saved_at = ${savedAt}
    WHERE id = ${input.id} AND user_id = ${userId}
    RETURNING id, title, point_ids, status, saved_at, updated_at
  `;
}

async function deleteSavedRouteRow(db: DbExecutor, userId: string, savedRouteId: string): Promise<unknown[]> {
  const result = await db.execute(sql`
    DELETE FROM saved_routes WHERE id = ${savedRouteId} AND user_id = ${userId} RETURNING id
  `);
  return result.rows;
}

/** Id-only existence probe used to classify a delete that lost the race;
 * never reveals the owner, so it is not a cross-owner oracle. */
async function existsSavedRouteRow(db: DbExecutor, savedRouteId: string): Promise<unknown[]> {
  const result = await db.execute(sql`SELECT 1 FROM saved_routes WHERE id = ${savedRouteId}`);
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
 * Neon-backed SavedRouteStore + DeleteSavedRouteStore + SavedRouteRepo over
 * the raw SQL executor (Drizzle typing only, see src/db/client.ts). Owns SQL
 * and row mapping only: the SaveSavedRoute action
 * (src/application/save-saved-route.ts) and DeleteSavedRoute action
 * (src/application/delete-saved-route.ts) own the ownership decisions and the
 * stable SAVED_ROUTE_* errors; the delete store performs one owner-predicated
 * atomic delete and reports only whether a row was deleted.
 */
export class NeonSavedRouteRepo implements SavedRouteRepo, SavedRouteStore, DeleteSavedRouteStore {
  constructor(private readonly db: DbExecutor) {}

  async listSavedRoutes(userId: string): Promise<ListSavedRoutesResult> {
    const result = await this.db.execute(sql`
      SELECT id, title, point_ids, status, saved_at, updated_at
      FROM saved_routes WHERE user_id = ${userId} ORDER BY updated_at DESC
    `);
    return { saved_routes: result.rows.map(toSavedRoute) };
  }

  async findOwner(id: string): Promise<OwnerLookup | undefined> {
    const result = await this.db.execute(sql`SELECT user_id, saved_at FROM saved_routes WHERE id = ${id}`);
    const row = result.rows[0];
    if (row === undefined) return undefined;
    if (!isRecord(row)) throw new Error("invalid saved route row");
    const userId = typeof row.user_id === "string" || row.user_id === null ? row.user_id : null;
    return { userId, savedAt: row.saved_at === undefined ? null : nullableIso(row.saved_at) };
  }

  async insert(userId: string, input: SaveSavedRouteInput, savedAt: string | null): Promise<SavedRoute> {
    const result = await this.db.execute(insertSavedRouteSql(userId, input, savedAt));
    return toSavedRoute(result.rows[0]);
  }

  async update(userId: string, input: SaveSavedRouteInput & { id: string }, savedAt: string | null): Promise<SavedRoute | null> {
    const result = await this.db.execute(updateSavedRouteSql(userId, input, savedAt));
    const row = result.rows[0];
    return row === undefined ? null : toSavedRoute(row);
  }

  /** One owner-predicated atomic delete; a lost delete is classified without
   * exposing the owner (src/application/delete-saved-route.ts). */
  async deleteOwned(userId: string, savedRouteId: string): Promise<DeleteOwnedOutcome> {
    if ((await deleteSavedRouteRow(this.db, userId, savedRouteId)).length > 0) {
      return { kind: "deleted" };
    }
    return (await existsSavedRouteRow(this.db, savedRouteId)).length > 0
      ? { kind: "not_owned" }
      : { kind: "missing" };
  }

  async claimSavedRoutes(userId: string, input: ClaimSavedRoutesInput): Promise<ClaimSavedRoutesResult> {
    return { claimed_count: (await claimSavedRouteRows(this.db, userId, input.session_id)).length };
  }
}
