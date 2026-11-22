/**
 * Neon-backed SavedRoute adapters over the Prisma query builder + the request's
 * runtime (see src/db/prisma.ts). Statements are built against the shared
 * data-plane contract and executed through the scope's `query`, so the dialect
 * binds and parameterises them and the plan carries its row type back.
 *
 * What that retires: the old executor seam returned `{ rows: unknown[] }`, so
 * every reader re-derived its own shape from `unknown` (`isRecord`, `strings`,
 * `requireSavedRouteRow`, `RecordRow`). The plans below name their columns, so
 * the row type arrives from the builder and those helpers are gone.
 *
 * What survives is the narrow part that is a policy rather than a shape:
 * `title` is nullable in the contract but non-null in the public model (null
 * reads as ""), the contract types `status` as a plain String where the public
 * model wants the domain's union, and `timestamptz` is normalized to ISO at the
 * wire boundary — a deployment fact about workerd, not a guess about the shape.
 *
 * Owns statement building and row mapping. The newest-update-first order the
 * SavedRouteReader port promises (src/application/list-saved-routes.ts) is the
 * list statement's own ORDER BY, so the database sorts and the action does not.
 */
import type {
  SaveSavedRouteInput,
  SavedRoute,
  SavedRouteStatus,
} from "@animichi/contract";
import type { SqlOrmPlan } from "@prisma/orm-postgres/relational-core/types";
import type { DeleteOwnedOutcome, DeleteSavedRouteStore } from "../application/delete-saved-route";
import type { SavedRouteReader } from "../application/list-saved-routes";
import type { SavedRouteStore } from "../application/save-saved-route";
import type { RowOf, UsersPlanExecutor, UsersPrisma, UsersStatementBuilder } from "../db/prisma";
import { iso, nullableIso } from "../db/timestamptz";
import { isSavedRouteStatus } from "../domain/saved-route-status";
import type { OwnerLookup } from "../domain/ownership";

/** The saved_routes columns every read and RETURNING path selects, so callers
 * get one shape — the SQL builder's half of the old `savedRouteReturning()`. */
const SAVED_ROUTE_COLUMNS = ["id", "title", "point_ids", "status", "saved_at", "updated_at"] as const;

/** The contract types `status` as a plain String; the public model wants the union. */
function savedRouteStatus(value: string): SavedRouteStatus {
  if (!isSavedRouteStatus(value)) throw new Error("invalid saved route row");
  return value;
}

function isPointId(value: string | null): value is string {
  return value !== null;
}

/** The contract types `point_ids` as `String?[]`; the public model has no null element. */
function savedRoutePointIds(values: readonly (string | null)[]): string[] {
  const pointIds = values.filter(isPointId);
  if (pointIds.length !== values.length) throw new Error("invalid saved route row");
  return pointIds;
}

/** Map one typed row onto the public saved-route model. */
export function toSavedRoute(row: SavedRouteRow): SavedRoute {
  return {
    id: row.id,
    title: row.title ?? "",
    point_ids: savedRoutePointIds(row.point_ids),
    status: savedRouteStatus(row.status),
    saved_at: nullableIso(row.saved_at),
    updated_at: iso(row.updated_at),
  };
}

/** Owner-scoped SELECT of the caller's own saved routes, newest update first.
 * Equal `updated_at` falls back to `id` (uuidv7, so the newest-created first),
 * which makes the order total. No LIMIT: the contract defines no page size, and
 * apps/web finds a route in this list before opening its detail page. */
function listOwnedPlan(builder: UsersStatementBuilder, userId: string) {
  return builder.public.saved_routes
    .select(...SAVED_ROUTE_COLUMNS)
    .where((fields, fns) => fns.eq(fields.user_id, userId))
    .orderBy("updated_at", { direction: "desc" })
    .orderBy("id", { direction: "desc" })
    .build();
}

/** The row type every saved_routes read and RETURNING path yields. */
export type SavedRouteRow = RowOf<ReturnType<typeof listOwnedPlan>>;

/** Id-and-owner facts only, for the ownership decision. */
function findOwnerPlan(builder: UsersStatementBuilder, id: string) {
  return builder.public.saved_routes
    .select("user_id", "saved_at")
    .where((fields, fns) => fns.eq(fields.id, id))
    .build();
}

/** One saved_routes INSERT row, as the contract's builder types it. */
export type SavedRouteInsertRow = Parameters<UsersStatementBuilder["public"]["saved_routes"]["insert"]>[0][number];

/** The columns a create writes. `id` is absent on purpose: the column's
 * `uuidv7()` default assigns it, so the database owns identity (#1632, §4.2).
 * `updated_at` is absent too wherever the column default may speak. */
function createValues(
  userId: string,
  input: SaveSavedRouteInput,
  savedAt: string | null,
): SavedRouteInsertRow {
  return {
    user_id: userId, title: input.title, point_ids: input.point_ids,
    status: input.status, saved_at: savedAt,
  };
}

/** INSERT ... RETURNING from one already-built values record. */
export function insertSavedRoutePlan(
  builder: UsersStatementBuilder,
  values: SavedRouteInsertRow,
): SqlOrmPlan<SavedRouteRow> {
  return builder.public.saved_routes
    .insert([values])
    .returning(...SAVED_ROUTE_COLUMNS)
    .build();
}

/** Owner-scoped UPDATE ... RETURNING. */
function updateSavedRoutePlan(
  builder: UsersStatementBuilder,
  userId: string,
  input: SaveSavedRouteInput & { id: string },
  savedAt: string | null,
) {
  return builder.public.saved_routes
    .update({ title: input.title, point_ids: input.point_ids, status: input.status, saved_at: savedAt })
    .where((fields, fns) => fns.eq(fields.id, input.id))
    .where((fields, fns) => fns.eq(fields.user_id, userId))
    .returning(...SAVED_ROUTE_COLUMNS)
    .build();
}

/** Owner-predicated atomic DELETE ... RETURNING id. */
function deleteOwnedPlan(builder: UsersStatementBuilder, userId: string, savedRouteId: string) {
  return builder.public.saved_routes
    .delete()
    .where((fields, fns) => fns.eq(fields.id, savedRouteId))
    .where((fields, fns) => fns.eq(fields.user_id, userId))
    .returning("id")
    .build();
}

/** Id-only existence probe used to classify a delete that lost the race;
 * never reveals the owner, so it is not a cross-owner oracle. */
function existsPlan(builder: UsersStatementBuilder, savedRouteId: string) {
  return builder.public.saved_routes
    .select("id")
    .where((fields, fns) => fns.eq(fields.id, savedRouteId))
    .build();
}

/** The typed single-row helper every statement above is read through. */
export async function firstRow<Row>(
  scope: UsersPlanExecutor,
  plan: SqlOrmPlan<Row>,
): Promise<Row | undefined> {
  return (await scope.query(plan))[0];
}

/** The caller's own saved routes, row-normalized, in the order the port promises. */
export class NeonSavedRouteRepo implements SavedRouteReader {
  constructor(private readonly prisma: UsersPrisma) {}

  async listOwned(userId: string): Promise<SavedRoute[]> {
    const rows = await this.prisma.executor.query(listOwnedPlan(this.prisma.builder, userId));
    return rows.map(toSavedRoute);
  }
}

/**
 * Neon-backed SavedRouteStore + DeleteSavedRouteStore: the create-or-update
 * save path and the delete path. Owns statement building and row mapping only:
 * the SaveSavedRoute action (src/application/save-saved-route.ts) and
 * DeleteSavedRoute action (src/application/delete-saved-route.ts) own the
 * ownership decisions and the stable SAVED_ROUTE_* errors; the delete store
 * performs one owner-predicated atomic delete and reports only whether a row
 * was deleted.
 */
export class NeonSavedRouteStore implements SavedRouteStore, DeleteSavedRouteStore {
  constructor(private readonly prisma: UsersPrisma) {}

  async findOwner(id: string): Promise<OwnerLookup | undefined> {
    const row = await firstRow(this.prisma.executor, findOwnerPlan(this.prisma.builder, id));
    return row === undefined ? undefined : { userId: row.user_id, savedAt: nullableIso(row.saved_at) };
  }

  async insert(userId: string, input: SaveSavedRouteInput, savedAt: string | null): Promise<SavedRoute> {
    const plan = insertSavedRoutePlan(this.prisma.builder, createValues(userId, input, savedAt));
    const row = await firstRow(this.prisma.executor, plan);
    if (row === undefined) throw new Error("saved route insert returned no row");
    return toSavedRoute(row);
  }

  async update(
    userId: string,
    input: SaveSavedRouteInput & { id: string },
    savedAt: string | null,
  ): Promise<SavedRoute | null> {
    const plan = updateSavedRoutePlan(this.prisma.builder, userId, input, savedAt);
    const row = await firstRow(this.prisma.executor, plan);
    return row === undefined ? null : toSavedRoute(row);
  }

  /** One owner-predicated atomic delete; a lost delete is classified without
   * exposing the owner (src/application/delete-saved-route.ts). */
  async deleteOwned(userId: string, savedRouteId: string): Promise<DeleteOwnedOutcome> {
    const deleted = await this.prisma.executor.query(deleteOwnedPlan(this.prisma.builder, userId, savedRouteId));
    if (deleted.length > 0) return { kind: "deleted" };
    const held = await this.prisma.executor.query(existsPlan(this.prisma.builder, savedRouteId));
    return held.length > 0 ? { kind: "not_owned" } : { kind: "missing" };
  }
}
