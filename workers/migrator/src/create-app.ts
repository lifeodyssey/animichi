import type { JWTVerifyGetKey } from "jose";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import {
  type GitHubOidcVerifier,
} from "@animichi/contract/oidc-github";
import { mainController } from "./request-auth";
import { registerCatalogSchema } from "./catalog-schema";
import { registerPreflight } from "./preflight";
import { resolveDsn } from "./database-url";
import { hasPrismaSnapshot, PRISMA_TARGET } from "./prisma-target";
import { MAX_PREFLIGHT_BYTES, parsePreflightMetadata, type PreflightMetadata } from "./preflight-metadata";
import type { SelectedExecutor, SelectedMigration } from "./selected-migration";
import { selectedExecutor } from "./selected-executor";

/**
 * #1051 / #1124 / #1589 / #1634 — the migrator's Hono application + environment.
 * One schema identity selects what applies, and the Prisma migration graph applies it.
 */

/** Migrator Worker bindings (Secrets Store DSN + apply-lock Durable Object). */
export interface Env {
  ENVIRONMENT?: string;
  MIGRATOR_DATABASE_URL?: string | SecretsStoreSecret;
  /** Fixed-name mutex for HTTP apply. Required on the production default path. */
  MIGRATOR_APPLY_LOCK?: DurableObjectNamespace;
  /** Selects the OIDC claims allowlist; only "production" opens that door. */
  MIGRATOR_OIDC_POLICY?: string;
}

/** Injectable boundaries used by the worker HTTP-seam tests. */
export interface MigratorDeps {
  verifier?: GitHubOidcVerifier;
  /** JWKS for the env-selected policy; `verifier` overrides the selection. */
  jwks?: JWTVerifyGetKey;
  /** The required catalog tables a target database is missing (#1230 Phase 1). */
  readMissingCatalogTables?: (dsn: string) => Promise<readonly string[]>;
  /** Native filesystem and locked executor seams for disposable PostgreSQL tests. */
  migrationsDir?: string;
  selected?: SelectedExecutor;
}

/**
 * #1365 / #1332 — `wrangler deploy` returning is not the new bundle serving. The Worker
 * publishes the schema identity it actually carries on `/healthz`, and refuses a request
 * naming any other identity before it touches the database. With one authority there is one
 * identity to publish and one to wait for (#1634).
 */
function healthz(c: Context<{ Bindings: Env }>): Response {
  return c.json({
    status: "ok",
    service: "migrator",
    env: c.env.ENVIRONMENT ?? "unknown",
    prismaTarget: PRISMA_TARGET,
  });
}

function successResponse(result: Extract<SelectedMigration, { kind: "success" }>): Response {
  return Response.json({
    success: true,
    exitCode: 0,
    ...(result.prisma === undefined ? {} : { prisma: result.prisma }),
  });
}

interface FailureJson {
  success: false;
  exitCode: number;
  error?: string;
}

function failureBody(result: Extract<SelectedMigration, { kind: "failure" }>): FailureJson {
  if (result.error === undefined) return { success: false, exitCode: result.exitCode };
  return { success: false, exitCode: result.exitCode, error: result.failureCode ?? "migration_failed" };
}

/**
 * 422, not 409: the 409 of this API is `stale_prisma_bundle`, which the deploy script answers
 * by waiting and re-POSTing (scripts/delivery/migrate-through-worker.sh). A request this
 * bundle can never satisfy must not land in that retry loop.
 */
function refusedResponse(result: Extract<SelectedMigration, { kind: "refused" }>): Response {
  return Response.json({ success: false, error: result.reason }, { status: 422 });
}

function outcomeResponse(result: SelectedMigration): Response {
  if (result.kind === "failure") return Response.json(failureBody(result), { status: 500 });
  if (result.kind === "refused") return refusedResponse(result);
  return successResponse(result);
}

type Guarded =
  | { ok: true; metadata: PreflightMetadata }
  | { ok: false; response: Response };

/** Identity, then body shape, then the bundle handshake — all before any DSN. */
async function guardRequest(c: Context<{ Bindings: Env }>, deps: MigratorDeps): Promise<Guarded> {
  const body = parsePreflightMetadata(await c.req.text());
  if (!body) return { ok: false, response: c.json({ error: "invalid_migration" }, 400) };
  if (body.stagingOnlyBaseline && c.env.MIGRATOR_OIDC_POLICY === "production") {
    return { ok: false, response: c.json({ error: "staging_only_baseline" }, 422) };
  }
  if (!await hasPrismaSnapshot(body.expectedPrismaRef, deps.migrationsDir)) {
    return { ok: false, response: c.json({ error: "stale_prisma_bundle", prismaTarget: PRISMA_TARGET }, 409) };
  }
  return { ok: true, metadata: body };
}

async function handleMigrate(c: Context<{ Bindings: Env }>, deps: MigratorDeps): Promise<Response> {
  const guard = await guardRequest(c, deps);
  if (!guard.ok) return guard.response;
  try {
    const dsn = await resolveDsn(c.env);
    if (dsn === undefined) return c.json({ error: "migrator database not configured" }, 503);
    return outcomeResponse(await selectedExecutor(c.env, deps).migrate(dsn, guard.metadata));
  } catch {
    return c.json({ success: false, error: "migration_unavailable" }, 500);
  }
}

/** Create an independently injectable migrator Hono application. */
export function createMigratorApp(deps: MigratorDeps = {}): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();
  app.get("/healthz", healthz);
  app.post("/migrate", mainController(deps), bodyLimit({
    maxSize: MAX_PREFLIGHT_BYTES, onError: (c) => c.json({ error: "invalid_migration" }, 413),
  }), (c) => handleMigrate(c, deps));
  registerPreflight(app, deps);
  registerCatalogSchema(app, deps);
  return app;
}
