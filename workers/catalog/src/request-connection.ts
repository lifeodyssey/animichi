/**
 * The `/catalog/*` boundary's oRPC router: every catalog procedure behind one middleware that opens
 * this request's database connection and gives it back when the procedure's call ends, never a
 * connection cached across requests (spec §4.2).
 *
 * Since Prisma rc.14 `connect()` opens the connection before it returns. The rc.14 upgrade guide
 * (step 5 of `serverless-connect-returns-connection`) asks for a request that needs no query to be
 * answered before `connect()`, and for an unreachable database to be handled at the `connect()`
 * call. oRPC runs this middleware after it matched the route and validated the input (`router.ts`
 * sets the validation index that puts it there), so an unknown path keeps Hono's 404 and invalid
 * input oRPC's 400, without a connection. A `connect()` that fails rejects inside the procedure,
 * where oRPC answers it as it answered a failed first query before rc.14: 500 with its JSON error
 * body, which carries neither the URL nor the driver's message. The failure is logged, as Hono's
 * default handler logged it while the boundary connected before routing.
 *
 * The `await` on `next()` is load-bearing: `await using` disposes on scope exit, so returning the
 * handler's promise unawaited would close the connection while the handler is still using it.
 */
import { catalogContract } from "@animichi/contract";
import { implement } from "@orpc/server";
import { prismaAccess } from "./db/prisma-first-use";
import { catalogRouter, type CatalogContext } from "./router";

/** What the boundary hands oRPC: the request's dependencies and the URL its connection opens on. */
interface CatalogRequestContext extends Omit<CatalogContext, "prisma"> {
  databaseUrl: string;
}

const boundary = implement(catalogContract).$context<CatalogRequestContext>();

const requestConnection = boundary.middleware(async ({ context, next }) => {
  const { acquireCatalogRuntime, catalogPrisma } = await prismaAccess().catch(logged);
  await using db = await acquireCatalogRuntime(context.databaseUrl).catch(logged);
  return await next({ context: { prisma: catalogPrisma(db) } });
});

/** Log a failure to load Prisma or to connect, then rethrow it for oRPC to answer. */
function logged(error: unknown): never {
  console.error(error);
  throw error;
}

/** `catalogRouter`, each procedure opening its request's connection after input validation. */
export const connectedCatalogRouter = boundary.use(requestConnection).router(catalogRouter);
