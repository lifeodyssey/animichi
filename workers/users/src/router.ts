import { usersContract } from "@animichi/contract";
import { implement } from "@orpc/server";
import { listSavedRoutes as listSavedRoutesAction } from "./application/list-saved-routes";
import { deleteSavedRoute as deleteSavedRouteAction } from "./application/delete-saved-route";
import type { DeleteSavedRouteStore } from "./application/delete-saved-route";
import type { ListSavedRoutesObserverPort, SavedRouteReader } from "./application/list-saved-routes";
import { saveSavedRoute as saveSavedRouteAction } from "./application/save-saved-route";
import type { SavedRouteStore } from "./application/save-saved-route";
import { listSessions as listSessionsHandler } from "./api/routes";
import { NeonSavedRouteRepo, NeonSavedRouteStore } from "./adapters/neon-saved-route-repo";
import type { DbExecutor } from "./db/client";

/** Per-request dependencies established by authentication middleware. */
export interface UsersContext { db: DbExecutor; userId: string }

const os = implement(usersContract).$context<UsersContext>();

/** Stateless Neon adapters bound to the per-request executor. */
const reader = (context: UsersContext): SavedRouteReader => new NeonSavedRouteRepo(context.db);
const store = (context: UsersContext): SavedRouteStore => new NeonSavedRouteStore(context.db);
const deleteStore = (context: UsersContext): DeleteSavedRouteStore => new NeonSavedRouteStore(context.db);

/** Redacted load observability: outcome, count, duration. Never route/actor ids. */
function listSavedRoutesObserver(): ListSavedRoutesObserverPort {
  return {
    record: (o) => {
      console.info(`list-saved-routes outcome=${o.outcome} count=${String(o.count)} duration_ms=${String(o.duration_ms)}`);
    },
  };
}

const listSavedRoutes = os.listSavedRoutes.handler(async ({ context }) =>
  listSavedRoutesAction(reader(context), context.userId, { observer: listSavedRoutesObserver() }),
);
const listSessions = os.listSessions.handler(async ({ input, context }) =>
  listSessionsHandler(context.db, context.userId, input),
);
const saveSavedRoute = os.saveSavedRoute.handler(async ({ input, context }) =>
  saveSavedRouteAction(store(context), context.userId, input),
);
const deleteSavedRoute = os.deleteSavedRoute.handler(async ({ input, context }) =>
  deleteSavedRouteAction(deleteStore(context), context.userId, input),
);

/** Users service oRPC implementation. */
export const usersRouter = {
  listSessions, listSavedRoutes, saveSavedRoute, deleteSavedRoute,
};
/** Users router type. */
export type UsersRouter = typeof usersRouter;
