import type { JWTVerifyGetKey } from "jose";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import {
  type GitHubOidcVerifier,
} from "@animichi/contract/oidc-github";
import { productionChain } from "./bundled-chain";
import { headsOf, type ChainSource } from "./chain";
import { NeonMigrationsLedger } from "./ledger";
import { applyMigration, type BoundedChainApply, type MigrationResult } from "./migration";
import { mainController } from "./request-auth";
import { registerCatalogSchema } from "./catalog-schema";
import { registerPreflight } from "./preflight";
import { resolveDsn } from "./database-url";
import { hasPrismaSnapshot, PRISMA_TARGET } from "./prisma-target";
import { MAX_PREFLIGHT_BYTES, parsePreflightMetadata, type PreflightMetadata } from "./preflight-metadata";
import type { SelectedExecutor, SelectedMigration } from "./selected-migration";
import { selectedExecutor } from "./selected-executor";

/**
 * #1051 / #1124 / #1589 — the migrator's Hono application + environment.
 * Default apply is the bounded neon-http chain behind the fixed lock.
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
  applyChain?: BoundedChainApply;
  readAppliedHead?: (dsn: string) => Promise<string | null>;
  /** The required catalog tables a target database is missing (#1230 Phase 1). */
  readMissingCatalogTables?: (dsn: string) => Promise<readonly string[]>;
  /** The chain this Worker carries; the handshake answers from it. */
  chain?: ChainSource;
  /** Native filesystem and locked executor seams for disposable PostgreSQL tests. */
  migrationsDir?: string;
  selected?: SelectedExecutor;
}

/**
 * #1365 / #1332 — `wrangler deploy` returning is not the new bundle serving.
 * The Worker publishes the chain it actually carries on `/healthz`, and
 * refuses a head that chain cannot reach before it touches the database.
 */
class BundleHandshake {
  private readonly heads: readonly string[];

  constructor(source: ChainSource) {
    this.heads = headsOf(source);
  }

  /** The last head of the carried chain — what a caller must wait for. */
  get head(): string | null {
    return this.heads[this.heads.length - 1] ?? null;
  }

  /** An expected head this bundle cannot reach means the caller is ahead of it. */
  stale(expectedHead: string | undefined): boolean {
    return expectedHead !== undefined && !this.heads.includes(expectedHead);
  }
}

function healthz(c: Context<{ Bindings: Env }>, bundle: BundleHandshake): Response {
  return c.json({
    status: "ok",
    service: "migrator",
    env: c.env.ENVIRONMENT ?? "unknown",
    bundleHead: bundle.head,
    prismaTarget: PRISMA_TARGET,
  });
}

function successResponse(result: Extract<SelectedMigration, { kind: "success" }>): Response {
  return Response.json({
    success: true,
    exitCode: 0,
    appliedHead: result.appliedHead,
    pathVerification: result.pathVerification,
    ...(result.prisma === undefined ? {} : { prisma: result.prisma }),
  });
}

interface FailureJson {
  success: false;
  exitCode: number;
  appliedHead: null;
  error?: string;
}

function failureBody(result: Extract<SelectedMigration, { kind: "failure" }>): FailureJson {
  if (result.error === undefined) {
    return { success: false, exitCode: result.exitCode, appliedHead: null };
  }
  return { success: false, exitCode: result.exitCode, appliedHead: null, error: result.failureCode ?? "migration_failed" };
}

/**
 * 422, not 409: the 409 of this API is `stale_bundle`, which the deploy script
 * answers by waiting and re-POSTing (scripts/delivery/migrate-through-worker.sh).
 * A request this bundle and ledger cannot satisfy never becomes satisfiable by
 * waiting, so it must not land in that retry loop.
 */
function refusedResponse(result: Extract<MigrationResult, { kind: "refused" }>): Response {
  return Response.json({ success: false, appliedHead: null, error: result.reason }, { status: 422 });
}

function outcomeResponse(result: SelectedMigration): Response {
  if (result.kind === "failure") return Response.json(failureBody(result), { status: 500 });
  if (result.kind === "refused") return refusedResponse(result);
  return successResponse(result);
}

async function chainApplyFor(
  env: Env,
  deps: MigratorDeps,
): Promise<BoundedChainApply> {
  if (deps.applyChain !== undefined) return deps.applyChain;
  if (env.MIGRATOR_APPLY_LOCK === undefined) throw new Error("migrator apply lock not configured");
  const { productionApply } = await import("./lock");
  return productionApply(env.MIGRATOR_APPLY_LOCK);
}

type Guarded =
  | { ok: true; metadata: PreflightMetadata }
  | { ok: false; response: Response };

/** Identity, then body shape, then the bundle handshake — all before any DSN. */
async function guardRequest(
  c: Context<{ Bindings: Env }>,
  deps: MigratorDeps,
  bundle: BundleHandshake,
): Promise<Guarded> {
  const body = parsePreflightMetadata(await c.req.text());
  if (!body) return { ok: false, response: c.json({ error: "invalid_migration" }, 400) };
  if (body.stagingOnlyBaseline && c.env.MIGRATOR_OIDC_POLICY === "production") {
    return { ok: false, response: c.json({ error: "staging_only_baseline" }, 422) };
  }
  if (body.expectedPrismaRef !== undefined && !await hasPrismaSnapshot(body.expectedPrismaRef, deps.migrationsDir)) {
    return { ok: false, response: c.json({ error: "stale_prisma_bundle", prismaTarget: PRISMA_TARGET }, 409) };
  }
  if (bundle.stale(body.expectedHead)) {
    return { ok: false, response: c.json({ error: "stale_bundle", bundleHead: bundle.head }, 409) };
  }
  return { ok: true, metadata: body };
}

async function handleMigrate(
  c: Context<{ Bindings: Env }>,
  deps: MigratorDeps,
  bundle: BundleHandshake,
): Promise<Response> {
  const guard = await guardRequest(c, deps, bundle);
  if (!guard.ok) return guard.response;
  try {
    const dsn = await resolveDsn(c.env);
    if (dsn === undefined) return c.json({ error: "migrator database not configured" }, 503);
    if (guard.metadata.expectedPrismaRef !== undefined) {
      return outcomeResponse(await selectedExecutor(c.env, deps).migrate(dsn, {
        ...guard.metadata, expectedPrismaRef: guard.metadata.expectedPrismaRef,
      }));
    }
    const applyChain = await chainApplyFor(c.env, deps);
    const readAppliedHead = deps.readAppliedHead ??
      ((value: string) => new NeonMigrationsLedger().readAppliedHead(value));
    const result = await applyMigration(dsn, { applyChain, readAppliedHead }, guard.metadata);
    return outcomeResponse(result);
  } catch {
    return c.json({ success: false, error: "migration_unavailable" }, 500);
  }
}

/** Create an independently injectable migrator Hono application. */
export function createMigratorApp(deps: MigratorDeps = {}): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();
  const bundle = new BundleHandshake(deps.chain ?? productionChain);
  app.get("/healthz", (c) => healthz(c, bundle));
  app.post("/migrate", mainController(deps), bodyLimit({
    maxSize: MAX_PREFLIGHT_BYTES, onError: (c) => c.json({ error: "invalid_migration" }, 413),
  }), (c) => handleMigrate(c, deps, bundle));
  registerPreflight(app, deps);
  registerCatalogSchema(app, deps);
  return app;
}
