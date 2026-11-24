/**
 * Protected admin command routes (issue #1016, AC5).
 *
 * POST /catalog/admin/full-ingest and POST /catalog/admin/canary sit behind the
 * bearer guard the snapshot rollback uses (`../adapters/inbound/bearer-guard.ts`), with
 * CATALOG_ADMIN_TOKEN as their token: a missing or wrong token, and any token
 * while none is configured, answers 401 before the database is resolved, so a
 * public caller never touches the pipeline. Both delegate to the production
 * daily pipeline via the injectable admin runner so the API test can assert the
 * exact pipeline is used with a controlled epoch.
 *
 * The routes own their Prisma runtime the same way `/catalog/*` does: one
 * acquired per request and disposed with `await using` when the handler
 * returns, never a connection cached across requests (spec §4.2). One seam
 * reaches the runner: the daily run and the snapshot publish it can trigger
 * are both plans on it (#1630).
 */
import type { Context, Hono } from "hono";
import type { CatalogPrisma } from "../db/prisma";
import { prismaAccess } from "../db/prisma-first-use";
import type { Env } from "../index";
import { fullIngest, runCanaryCommand } from "./admin-commands";
import type { DailyRunOutcome } from "../publish/daily-snapshot";
import type { ObjectStore } from "../publish/object-store";
import { bearerGuard } from "../adapters/inbound/bearer-guard";

/** The seam one admin command runs on, resolved from the environment. */
export interface AdminSeams {
  readonly query: CatalogPrisma;
}

/** The injectable admin pipeline runner (defaults to the production path). */
export interface AdminDeps {
  /** Full ingest mirrors the production cron (publishes after a complete run). */
  runFull: (seams: AdminSeams, epochMs: number, store: ObjectStore | null) => Promise<DailyRunOutcome>;
  /** Canary is ingest-only and never touches the published catalog store. */
  runCanary: (seams: AdminSeams, epochMs: number) => Promise<DailyRunOutcome>;
}

/** A clock seam so tests control the run epoch (no timing asserts). */
export type Clock = () => number;

/** What the resolver hands one admin command: the connection string its Prisma
 *  runtime is acquired from. */
export interface AdminConnection {
  readonly connStr: string;
}

/** A connection resolver seam; tests substitute a fake, `null` means
 *  unconfigured (503). */
export type ResolveDb = (env: Env) => Promise<AdminConnection | null>;

/** An object-store resolver seam; a null store means a non-publishing full ingest. */
export type ResolveStore = (env: Env) => ObjectStore | null;

/** This request's Prisma seam, plus the disposal that gives its connection back. */
export interface AdminPrisma {
  readonly query: CatalogPrisma;
  dispose(): Promise<void>;
}

/** A Prisma-acquisition seam; tests substitute a fake so no request dials out. */
export type AcquirePrisma = (connStr: string) => Promise<AdminPrisma>;

/** The production acquisition: one runtime per admin request, disposed after. */
async function defaultAdminPrisma(connStr: string): Promise<AdminPrisma> {
  const { acquireCatalogRuntime, catalogPrisma } = await prismaAccess();
  const runtime = await acquireCatalogRuntime(connStr);
  return {
    query: catalogPrisma(runtime),
    dispose: async () => { await runtime[Symbol.asyncDispose](); },
  };
}

/** The mount's injectable seams; every one has a production default. */
export interface AdminRouteOptions {
  deps?: AdminDeps;
  nowClock?: Clock;
  resolveDb?: ResolveDb | null;
  resolveStore?: ResolveStore | null;
  acquirePrisma?: AcquirePrisma;
}

/** Build the production admin runner. */
export function createAdminDeps(): AdminDeps {
  return {
    runFull: (seams, epochMs, store) => fullIngest(seams.query, epochMs, store),
    runCanary: (seams, epochMs) => runCanaryCommand(seams.query, epochMs),
  };
}

/** Mount the protected admin command routes on the catalog app (AC5). */
export function mountAdminRoutes(
  app: Hono<{ Bindings: Env }>,
  options: AdminRouteOptions = {},
): void {
  const deps = options.deps ?? createAdminDeps();
  const nowClock = options.nowClock ?? (() => Date.now());
  const resolveDb = options.resolveDb ?? null;
  const resolveStore = options.resolveStore ?? null;
  const acquire = options.acquirePrisma ?? defaultAdminPrisma;
  const guard = bearerGuard((env) => env.CATALOG_ADMIN_TOKEN);
  app.post("/catalog/admin/full-ingest", guard, adminHandler(deps.runFull, nowClock, resolveDb, resolveStore, acquire));
  app.post("/catalog/admin/canary", guard, adminHandler(deps.runCanary, nowClock, resolveDb, null, acquire));
}

/** One admin route behind its guard: resolve deps, run the injected pipeline. */
function adminHandler(
  runner: (seams: AdminSeams, epochMs: number, store: ObjectStore | null) => Promise<DailyRunOutcome>,
  nowClock: Clock,
  resolveDb: ResolveDb | null,
  resolveStore: ResolveStore | null,
  acquire: AcquirePrisma,
): (c: Context<{ Bindings: Env }>) => Promise<Response> {
  return async (c) => {
    const connection = resolveDb === null ? null : await resolveDb(c.env);
    if (connection === null) return c.json({ error: "catalog database not configured" }, 503);
    const store = resolveStore === null ? null : resolveStore(c.env);
    // One runtime for this request, given back when the handler returns.
    const prisma = await acquire(connection.connStr);
    try {
      const seams: AdminSeams = { query: prisma.query };
      return c.json(await runner(seams, nowClock(), store));
    } finally {
      await prisma.dispose();
    }
  };
}
