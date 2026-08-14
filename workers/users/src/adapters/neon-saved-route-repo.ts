import type {
  SaveSavedRouteInput,
  SavedRoute,
  SavedRouteStatus,
} from "@animichi/contract";
import { and, eq } from "drizzle-orm";
import type { DeleteOwnedOutcome, DeleteSavedRouteStore } from "../application/delete-saved-route";
import type { SavedRouteStore } from "../application/save-saved-route";
import type { UsersDb } from "../db/client";
import { savedRoutes } from "../db/schema";
import type { OwnerLookup } from "../domain/ownership";
import { isSavedRouteStatus } from "../domain/saved-route-status";
import type { SavedRouteReader } from "../application/list-saved-routes";

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

/** The columns every read / RETURNING path selects, so callers get one shape. */
function savedRouteReturning() {
  return {
    id: savedRoutes.id, title: savedRoutes.title, point_ids: savedRoutes.pointIds,
    status: savedRoutes.status, saved_at: savedRoutes.savedAt, updated_at: savedRoutes.updatedAt,
  };
}

/** Convert a nullable ISO timestamp to the Date the Drizzle timestamp maps on bind. */
function savedAtToDriver(savedAt: string | null): Date | null {
  return savedAt === null ? null : new Date(savedAt);
}

/** Owner-scoped INSERT ... RETURNING, built with the Drizzle query builder. */
function insertSavedRouteStatement(userId: string, input: SaveSavedRouteInput, savedAt: string | null) {
  return (db: UsersDb) =>
    db.insert(savedRoutes)
      .values({
        userId, title: input.title, pointIds: input.point_ids,
        status: input.status, savedAt: savedAtToDriver(savedAt),
      })
      .returning(savedRouteReturning());
}

/** Owner-scoped UPDATE ... RETURNING, built with the Drizzle query builder. */
function updateSavedRouteStatement(userId: string, input: SaveSavedRouteInput & { id: string }, savedAt: string | null) {
  return (db: UsersDb) =>
    db.update(savedRoutes)
      .set({
        title: input.title, pointIds: input.point_ids,
        status: input.status, savedAt: savedAtToDriver(savedAt),
      })
      .where(and(eq(savedRoutes.id, input.id), eq(savedRoutes.userId, userId)))
      .returning(savedRouteReturning());
}

/** Owner-predicated atomic DELETE ... RETURNING id, built with the builder. */
function deleteOwnedStatement(userId: string, savedRouteId: string) {
  return (db: UsersDb) =>
    db.delete(savedRoutes)
      .where(and(eq(savedRoutes.id, savedRouteId), eq(savedRoutes.userId, userId)))
      .returning({ id: savedRoutes.id });
}

/** Id-only existence probe used to classify a delete that lost the race;
 * never reveals the owner, so it is not a cross-owner oracle. */
function existsStatement(savedRouteId: string) {
  return (db: UsersDb) =>
    db.select({ id: savedRoutes.id }).from(savedRoutes).where(eq(savedRoutes.id, savedRouteId));
}

/**
 * Neon-backed SavedRouteReader over the Drizzle query builder + `UsersDb`
 * executor seam (see src/db/client.ts). Statements are built with the query
 * builder and run through `db.execute`, so the dialect binds and parameterises
 * them. Owns statement building and row mapping only — the ListSavedRoutes
 * action (src/application/list-saved-routes.ts) owns the newest-update-first
 * ordering policy.
 */
export class NeonSavedRouteRepo implements SavedRouteReader {
  constructor(private readonly db: UsersDb) {}

  /** The caller's own saved routes, row-normalized, in store order. */
  async listOwned(userId: string): Promise<SavedRoute[]> {
    const statement = this.db
      .select(savedRouteReturning())
      .from(savedRoutes)
      .where(eq(savedRoutes.userId, userId));
    const result = await this.db.execute(statement);
    return result.rows.map(toSavedRoute);
  }
}

/**
 * Neon-backed SavedRouteStore + DeleteSavedRouteStore over the query builder +
 * `UsersDb` executor seam: the create-or-update save path and the delete path.
 * Owns statement building and row mapping only: the SaveSavedRoute action
 * (src/application/save-saved-route.ts) and DeleteSavedRoute action
 * (src/application/delete-saved-route.ts) own the ownership decisions and the
 * stable SAVED_ROUTE_* errors; the delete store performs one owner-predicated
 * atomic delete and reports only whether a row was deleted.
 */
export class NeonSavedRouteStore implements SavedRouteStore, DeleteSavedRouteStore {
  constructor(private readonly db: UsersDb) {}

  async findOwner(id: string): Promise<OwnerLookup | undefined> {
    const statement = this.db
      .select({ userId: savedRoutes.userId, savedAt: savedRoutes.savedAt })
      .from(savedRoutes)
      .where(eq(savedRoutes.id, id));
    const result = await this.db.execute(statement);
    const row = result.rows[0];
    if (row === undefined) return undefined;
    if (!isRecord(row)) throw new Error("invalid saved route row");
    const userId = typeof row.user_id === "string" || row.user_id === null ? row.user_id : null;
    return { userId, savedAt: row.saved_at === undefined ? null : nullableIso(row.saved_at) };
  }

  async insert(userId: string, input: SaveSavedRouteInput, savedAt: string | null): Promise<SavedRoute> {
    const result = await this.db.execute(insertSavedRouteStatement(userId, input, savedAt)(this.db));
    return toSavedRoute(result.rows[0]);
  }

  async update(userId: string, input: SaveSavedRouteInput & { id: string }, savedAt: string | null): Promise<SavedRoute | null> {
    const result = await this.db.execute(updateSavedRouteStatement(userId, input, savedAt)(this.db));
    const row = result.rows[0];
    return row === undefined ? null : toSavedRoute(row);
  }

  /** One owner-predicated atomic delete; a lost delete is classified without
   * exposing the owner (src/application/delete-saved-route.ts). */
  async deleteOwned(userId: string, savedRouteId: string): Promise<DeleteOwnedOutcome> {
    if ((await this.db.execute(deleteOwnedStatement(userId, savedRouteId)(this.db))).rows.length > 0) {
      return { kind: "deleted" };
    }
    return (await this.db.execute(existsStatement(savedRouteId)(this.db))).rows.length > 0
      ? { kind: "not_owned" }
      : { kind: "missing" };
  }
}
