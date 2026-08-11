import type { SaveSavedRouteInput, SavedRoute } from "@animichi/contract";
import { decideOwnership, type OwnerLookup } from "../domain/ownership";
import { savedAtForStatus } from "../domain/saved-route-status";
import { savedRouteNotFound, savedRouteNotOwned } from "../lib/errors";

/** The one outbound capability SaveSavedRoute needs from the Neon store. */
export interface SavedRouteStore {
  /** The row's ownership facts, or `undefined` when no row has this id. */
  findOwner(id: string): Promise<OwnerLookup | undefined>;
  /** Persist a brand-new route with the caller-computed saved_at. */
  insert(userId: string, input: SaveSavedRouteInput, savedAt: string | null): Promise<SavedRoute>;
  /** Persist an owned route; `null` means the row is no longer owned by this
   * user (vanished or re-owned between the read and this write) — mapped to
   * SAVED_ROUTE_NOT_OWNED, matching the pre-action adapter behaviour. */
  update(userId: string, input: SaveSavedRouteInput & { id: string }, savedAt: string | null): Promise<SavedRoute | null>;
}

/** Injectable clock so saved_at is deterministic in tests. */
export interface SaveSavedRouteOptions {
  now?: () => string;
}

/** Create or update one authenticated saved route. The action owns the
 * create/update choice, the ownership decision, the status/saved-at policy,
 * and the stable SAVED_ROUTE_* errors; the store owns only the SQL. */
export async function saveSavedRoute(
  store: SavedRouteStore,
  userId: string,
  input: SaveSavedRouteInput,
  opts: SaveSavedRouteOptions = {},
): Promise<SavedRoute> {
  const now = opts.now ?? (() => new Date().toISOString());
  const id = input.id;
  if (id === undefined) {
    return store.insert(userId, input, savedAtForStatus(input.status, null, now()));
  }
  return updateOwned(store, userId, id, input, now);
}

async function updateOwned(
  store: SavedRouteStore,
  userId: string,
  id: string,
  input: SaveSavedRouteInput,
  now: () => string,
): Promise<SavedRoute> {
  const decision = decideOwnership(await store.findOwner(id), userId);
  if (decision.kind === "not_found") throw savedRouteNotFound(id);
  if (decision.kind === "not_owned") throw savedRouteNotOwned(id);
  const updated = await store.update(
    userId, { ...input, id }, savedAtForStatus(input.status, decision.owner.savedAt, now()),
  );
  if (updated === null) throw savedRouteNotOwned(id);
  return updated;
}
