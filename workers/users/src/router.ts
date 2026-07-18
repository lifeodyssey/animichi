import { usersContract } from "@seichijunrei/contract";
import { implement } from "@orpc/server";
import {
  claimRoutes as claimHandler,
  deleteRoute as deleteHandler,
  listRoutes as listHandler,
  saveRoute as saveHandler,
} from "./api/routes";
import type { DbExecutor } from "./db/client";

/** Per-request dependencies established by authentication middleware. */
export interface UsersContext { db: DbExecutor; userId: string }

const os = implement(usersContract).$context<UsersContext>();

const listRoutes = os.listRoutes.handler(async ({ context }) =>
  listHandler(context.db, context.userId),
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
export const usersRouter = { listRoutes, saveRoute, deleteRoute, claimRoutes };
/** Users router type. */
export type UsersRouter = typeof usersRouter;
