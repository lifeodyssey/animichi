import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { Hono, type Context, type MiddlewareHandler, type Next } from "hono";
import { IDEMPOTENCY_KEY_HEADER, IDEMPOTENCY_KEY_MAX_LENGTH } from "@animichi/contract";
import { AUTHORIZATION_HEADER, USER_IDENTITY_HEADER, USER_TYPE_HEADER } from "@animichi/contract/internal-binding";
import { acquireUsersRuntime, usersPrisma, type UsersPrisma } from "./db/prisma";
import { USERS_ERRORS } from "./lib/errors";
import { usersRouter, type UsersContext } from "./router";

/** Users Worker bindings. Secrets are supplied outside wrangler vars. */
export interface Env {
  ENVIRONMENT?: string;
  DATABASE_URL?: string | SecretsStoreSecret;
}

/** Injectable boundaries used by workerd tests. */
export interface UsersAppDeps {
  /** Replace this request's Prisma access — a test seam, never a deployment knob. */
  makePrisma?: (connStr: string) => UsersPrisma;
}

/** In staging the DSN arrives as a Secrets Store binding (#912 PR2): `.get()`
 * resolves the string; the string branch keeps local dev and tests unchanged. */
async function connectionString(env: Env): Promise<string | undefined> {
  const url = env.DATABASE_URL;
  if (url == null) return undefined;
  return typeof url === "string" ? url : await url.get();
}

const unauthorized = {
  error: { code: "unauthorized", message: "Valid credentials required." },
};

/** Typed 400 envelope for an over-long Idempotency-Key (abuse-bounded #1011). */
const idempotencyKeyInvalid = {
  defined: true, code: "IDEMPOTENCY_KEY_INVALID", status: 400,
  message: USERS_ERRORS.IDEMPOTENCY_KEY_INVALID.message, data: {},
};

function isResponse(value: unknown): value is Response {
  return value instanceof Response;
}

function healthz(c: Context<{ Bindings: Env }>): Response {
  return c.json({ status: "ok", service: "users", env: c.env.ENVIRONMENT ?? "unknown" });
}

/**
 * The internal-identity boundary (AUTH-2 #950): the users service trusts ONLY
 * the edge's verified identity, which arrives over the USERS service binding
 * as `X-User-Id` (the edge stripped `Authorization` and any caller-supplied
 * identity headers first — see workers/edge/gateway/forward.ts forwardUsers).
 *
 * A request that still carries `Authorization` is raw bearer access: it did not
 * come from the edge (which deletes the header), so the token is unverified and
 * the request is flat-401. There is no anonymous path here, so a missing
 * identity is also 401.
 */
function edgeIdentity(c: Context<{ Bindings: Env }>): string | null {
  if (c.req.header(AUTHORIZATION_HEADER) != null) return null;
  if (c.req.header(USER_TYPE_HEADER) !== "human") return null;
  const userId = c.req.header(USER_IDENTITY_HEADER);
  return typeof userId === "string" && userId.length > 0 ? userId : null;
}

/** The identity and retry-safe key this request is admitted with. */
interface Admission { userId: string; idempotencyKey?: string }

/** Admission, or the Response that refuses the request before any work. */
function admit(c: Context<{ Bindings: Env }>): Admission | Response {
  const userId = edgeIdentity(c);
  if (userId === null) return c.json(unauthorized, 401);
  // The retry-safe create key, forwarded unchanged from the edge; the save
  // handler only honors it for a create (no id). Reject an over-long token
  // here, before dispatch, so the ledger never sees an unbounded PK key value.
  const idempotencyKey = c.req.header(IDEMPOTENCY_KEY_HEADER);
  if (idempotencyKey !== undefined && idempotencyKey.length > IDEMPOTENCY_KEY_MAX_LENGTH) {
    return c.json(idempotencyKeyInvalid, 400);
  }
  return idempotencyKey === undefined ? { userId } : { userId, idempotencyKey };
}

async function handleMatched(
  c: Context<{ Bindings: Env }>,
  next: Next,
  apiHandler: OpenAPIHandler<UsersContext>,
  context: UsersContext,
): Promise<Response | undefined> {
  const { matched, response } = await apiHandler.handle(c.req.raw, { context });
  if (matched) return c.newResponse(response.body, response);
  await next();
}

interface UsersV1Service {
  apiHandler: OpenAPIHandler<UsersContext>;
  deps: UsersAppDeps;
}

async function guardUsersV1(
  service: UsersV1Service,
  c: Context<{ Bindings: Env }, string>, next: Next,
): Promise<Response | undefined> {
  const connStr = await connectionString(c.env);
  if (!connStr) return c.json({ error: "users database not configured" }, 503);
  const admission = admit(c);
  if (isResponse(admission)) return admission;
  const injected = service.deps.makePrisma?.(connStr);
  if (injected !== undefined) {
    return handleMatched(c, next, service.apiHandler, { prisma: injected, ...admission });
  }
  // Each request acquires its own Prisma runtime and gives it back when this
  // scope exits — never a connection cached across requests (spec §4.2). The
  // await is load-bearing: `await using` disposes on scope exit, so returning
  // the handler's promise unawaited would hand back the connection while the
  // request is still using it.
  await using runtime = await acquireUsersRuntime(connStr);
  return await handleMatched(c, next, service.apiHandler, { prisma: usersPrisma(runtime), ...admission });
}

/** Create an independently injectable Users Hono application. */
export function createUsersApp(deps: UsersAppDeps = {}): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();
  const apiHandler = new OpenAPIHandler(usersRouter);
  const usersV1Guard: MiddlewareHandler<{ Bindings: Env }, "/v1/users/*"> = async (c, next) =>
    guardUsersV1({ apiHandler, deps }, c, next);
  app.get("/healthz", healthz);
  app.use("/v1/users/*", usersV1Guard);
  return app;
}

export default createUsersApp();
export { usersRouter };
export type { UsersRouter } from "./router";
