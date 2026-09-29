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
import { resolveRuntimePasswords } from "./service-roles";
import { MAX_PREFLIGHT_BYTES, parsePreflightMetadata, type PreflightMetadata } from "./preflight-metadata";
import type { SelectedExecutor, SelectedMigration } from "./selected-migration";
import { selectedExecutor } from "./selected-executor";
import { redactedCause } from "./redacted-cause";

/**
 * #1051 / #1124 / #1589 / #1634 — the migrator's Hono application + environment.
 * One schema identity selects what applies, and the Prisma migration graph applies it.
 */

/** Migrator Worker bindings (Secrets Store DSN + apply-lock Durable Object). */
export interface Env {
  ENVIRONMENT?: string;
  MIGRATOR_DATABASE_URL?: string | SecretsStoreSecret;
  /** #1915 — the three runtime role passwords, applied by SQL before the chain. */
  CATALOG_SVC_PASSWORD?: string | SecretsStoreSecret;
  USERS_SVC_PASSWORD?: string | SecretsStoreSecret;
  AGENT_SVC_PASSWORD?: string | SecretsStoreSecret;
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
  cause?: string;
}

/**
 * `result.error` may be a driver message, so only the stable `failureCode` is published.
 * `result.cause` is different in kind: it crosses `redactedCause` before this file sees it —
 * at the control boundary (`prisma-control.ts`) for the fields a reported native failure
 * stated beyond its code (#1891), and in `selected-migration.ts` for a failure that threw
 * (#1868) — so it is publishable as it stands.
 */
function failureBody(result: Extract<SelectedMigration, { kind: "failure" }>): FailureJson {
  if (result.error === undefined) return { success: false, exitCode: result.exitCode };
  const named: FailureJson = { success: false, exitCode: result.exitCode, error: result.failureCode ?? "migration_failed" };
  return result.cause === undefined ? named : { ...named, cause: result.cause };
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
  if (!await hasPrismaSnapshot(body.expectedPrismaRef, deps.migrationsDir)) {
    return { ok: false, response: c.json({ error: "stale_prisma_bundle", prismaTarget: PRISMA_TARGET }, 409) };
  }
  return { ok: true, metadata: body };
}

/**
 * The apply never produced an outcome at all — the secret would not resolve, the lock is
 * unbound, or the Durable Object RPC itself failed. That last one is how staging died on
 * 2026-09-22: the object was reset mid-apply and this catch reported the platform's message
 * as a bare `migration_unavailable` (#1868). A distinct name, because `migration_unavailable`
 * now means the narrower thing — the apply ran and threw — and the two want different
 * operator responses: this one leaves the database in an unread state.
 */
function dispatchFailure(c: Context<{ Bindings: Env }>, error: unknown): Response {
  const cause = redactedCause(error);
  console.error(`[migrator] apply dispatch failed: ${cause}`);
  return c.json({ success: false, error: "apply_dispatch_failed", cause }, 500);
}

async function handleMigrate(c: Context<{ Bindings: Env }>, deps: MigratorDeps): Promise<Response> {
  const guard = await guardRequest(c, deps);
  if (!guard.ok) return guard.response;
  try {
    const dsn = await resolveDsn(c.env);
    if (dsn === undefined) return c.json({ error: "migrator database not configured" }, 503);
    const passwords = await resolveRuntimePasswords(c.env);
    if (passwords === undefined) return c.json({ error: "service role passwords not configured" }, 503);
    return outcomeResponse(await selectedExecutor(c.env, deps).migrate(dsn, passwords, guard.metadata));
  } catch (error) {
    return dispatchFailure(c, error);
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
