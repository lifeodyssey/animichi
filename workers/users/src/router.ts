import { usersContract } from "@animichi/contract";
import { implement } from "@orpc/server";
import {
  claimRoutes as claimHandler,
  deleteRoute as deleteHandler,
  listRoutes as listHandler,
  listSessions as listSessionsHandler,
  saveRoute as saveHandler,
} from "./api/routes";
import { NeonSavedRouteRepo } from "./adapters/neon-saved-route-repo";
import type { DbExecutor } from "./db/client";
import type { SavedRouteRepo } from "./domain/ports";

/** Per-request dependencies established by authentication middleware. */
export interface UsersContext { db: DbExecutor; userId: string }

const os = implement(usersContract).$context<UsersContext>();

/** Stateless Neon SavedRouteRepo bound to the per-request executor. */
const repo = (context: UsersContext): SavedRouteRepo => new NeonSavedRouteRepo(context.db);

const listRoutes = os.listRoutes.handler(async ({ context }) =>
  listHandler(repo(context), context.userId),
);
const listSessions = os.listSessions.handler(async ({ input, context }) =>
  listSessionsHandler(context.db, context.userId, input),
);
const saveRoute = os.saveRoute.handler(async ({ input, context }) =>
  saveHandler(repo(context), context.userId, input),
);
const deleteRoute = os.deleteRoute.handler(async ({ input, context }) =>
  deleteHandler(repo(context), context.userId, input),
);
const claimRoutes = os.claimRoutes.handler(async ({ input, context }) =>
  claimHandler(repo(context), context.userId, input),
);

/** Users service oRPC implementation. */
export const usersRouter = { listSessions, listRoutes, saveRoute, deleteRoute, claimRoutes };
/** Users router type. */
export type UsersRouter = typeof usersRouter;
