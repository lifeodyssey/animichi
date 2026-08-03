import { usersContract } from "@animichi/contract";
import { implement } from "@orpc/server";
import {
  claimRoutes as claimHandler,
  deleteRoute as deleteHandler,
  listRoutes as listHandler,
  listSessions as listSessionsHandler,
  saveRoute as saveHandler,
} from "./api/routes";
import type { DbExecutor } from "./db/client";

/** Per-request dependencies established by authentication middleware. */
export interface UsersContext { db: DbExecutor; userId: string }

const os = implement(usersContract).$context<UsersContext>();

const listRoutes = os.listRoutes.handler(async ({ context }) =>
  listHandler(context.db, context.userId),
);
const listSessions = os.listSessions.handler(async ({ input, context }) =>
  listSessionsHandler(context.db, context.userId, input),
);
const saveRoute = os.saveRoute.handler(async ({ input, context }) =>
  saveHandler(context.db, context.userId, input),
);
const deleteRoute = os.deleteRoute.handler(async ({ input, context }) =>
  deleteHandler(context.db, context.userId, input),
);
const claimRoutes = os.claimRoutes.handler(async ({ input, context }) =>
  claimHandler(context.db, context.userId, input),
);

/** Users service oRPC implementation. */
export const usersRouter = { listSessions, listRoutes, saveRoute, deleteRoute, claimRoutes };
/** Users router type. */
export type UsersRouter = typeof usersRouter;
