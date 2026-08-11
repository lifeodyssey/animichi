import { usersContract } from "@animichi/contract";
import { implement } from "@orpc/server";
import { saveSavedRoute as saveSavedRouteAction } from "./application/save-saved-route";
import type { SavedRouteStore } from "./application/save-saved-route";
import {
  claimSavedRoutes as claimHandler,
  deleteSavedRoute as deleteHandler,
  listSavedRoutes as listHandler,
  listSessions as listSessionsHandler,
} from "./api/routes";
import { NeonSavedRouteRepo } from "./adapters/neon-saved-route-repo";
import type { DbExecutor } from "./db/client";
import type { SavedRouteRepo } from "./domain/ports";

/** Per-request dependencies established by authentication middleware. */
export interface UsersContext { db: DbExecutor; userId: string }

const os = implement(usersContract).$context<UsersContext>();

/** Stateless Neon SavedRouteRepo bound to the per-request executor. */
const repo = (context: UsersContext): SavedRouteRepo => new NeonSavedRouteRepo(context.db);
const store = (context: UsersContext): SavedRouteStore => new NeonSavedRouteRepo(context.db);

const listSavedRoutes = os.listSavedRoutes.handler(async ({ context }) =>
  listHandler(repo(context), context.userId),
);
const listSessions = os.listSessions.handler(async ({ input, context }) =>
  listSessionsHandler(context.db, context.userId, input),
);
const saveSavedRoute = os.saveSavedRoute.handler(async ({ input, context }) =>
  saveSavedRouteAction(store(context), context.userId, input),
);
const deleteSavedRoute = os.deleteSavedRoute.handler(async ({ input, context }) =>
  deleteHandler(repo(context), context.userId, input),
);
const claimSavedRoutes = os.claimSavedRoutes.handler(async ({ input, context }) =>
  claimHandler(repo(context), context.userId, input),
);

/** Users service oRPC implementation. */
export const usersRouter = {
  listSessions, listSavedRoutes, saveSavedRoute, deleteSavedRoute, claimSavedRoutes,
};
/** Users router type. */
export type UsersRouter = typeof usersRouter;
