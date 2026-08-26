/**
 * Protected admin command routes (issue #1016, AC5).
 *
 * POST /catalog/admin/full-ingest and POST /catalog/admin/canary follow the
 * same SNAPSHOT_ADMIN_TOKEN bearer-guard convention as the snapshot rollback
 * surface: absent/wrong token is a 401/503, and a public caller never touches
 * the pipeline. Both delegate to the production daily pipeline via the
 * injectable admin runner so the API test can assert the exact pipeline is
 * used with a controlled epoch.
 */
import type { Context, Hono } from "hono";
import type { CatalogDb } from "../db/client";
import type { Env } from "../index";
import { fullIngest, runCanaryCommand } from "./admin-commands";
import type { DailyRunOutcome } from "../publish/daily-snapshot";
import type { ObjectStore } from "../publish/object-store";
import { timingSafeEqual } from "../lib/timing";

/** The injectable admin pipeline runner (defaults to the production path). */
export interface AdminDeps {
  /** Full ingest mirrors the production cron (publishes after a complete run). */
  runFull: (db: CatalogDb, epochMs: number, store: ObjectStore | null) => Promise<DailyRunOutcome>;
  /** Canary is ingest-only and never touches the published catalog store. */
  runCanary: (db: CatalogDb, epochMs: number) => Promise<DailyRunOutcome>;
}

/** A clock seam so tests control the run epoch (no timing asserts). */
export type Clock = () => number;

/** A connection resolver seam; tests substitute a fake db. */
export type ResolveDb = (env: Env) => Promise<CatalogDb | null>;

/** An object-store resolver seam; a null store means a non-publishing full ingest. */
export type ResolveStore = (env: Env) => ObjectStore | null;

/** Build the production admin runner. */
export function createAdminDeps(): AdminDeps {
  return { runFull: fullIngest, runCanary: runCanaryCommand };
}

/** Mount the protected admin command routes on the catalog app (AC5). */
export function mountAdminRoutes(
  app: Hono<{ Bindings: Env }>,
  deps: AdminDeps = createAdminDeps(),
  nowClock: Clock = () => Date.now(),
  resolveDb: ResolveDb | null = null,
  resolveStore: ResolveStore | null = null,
): void {
  app.post("/catalog/admin/full-ingest", adminHandler(deps.runFull, nowClock, resolveDb, resolveStore));
  app.post("/catalog/admin/canary", adminHandler(deps.runCanary, nowClock, resolveDb, null));
}

/** One protected admin route: guard, resolve deps, run the injected pipeline. */
function adminHandler(
  runner: (db: CatalogDb, epochMs: number, store: ObjectStore | null) => Promise<DailyRunOutcome>,
  nowClock: Clock,
  resolveDb: ResolveDb | null,
  resolveStore: ResolveStore | null,
): (c: Context<{ Bindings: Env }>) => Promise<Response> {
  return async (c) => {
    const token = await adminToken(c.env);
    if (!authorizedAdmin(c.req.header("authorization"), token)) {
      return c.json({ error: "unauthorized" }, 401);
    }
    const db = resolveDb === null ? null : await resolveDb(c.env);
    if (db === null) return c.json({ error: "catalog database not configured" }, 503);
    const store = resolveStore === null ? null : resolveStore(c.env);
    const outcome = await runner(db, nowClock(), store);
    return c.json(outcome);
  };
}

/** Resolve the admin token from the env, whether a plain string (tests/local
 *  dev) or a Secrets Store binding (system-health-audit 2026-08-26 §2.4). */
async function adminToken(env: Env): Promise<string | undefined> {
  const token = env.CATALOG_ADMIN_TOKEN;
  if (token === undefined) return undefined;
  return typeof token === "string" ? token : await token.get();
}

/** Constant-time bearer guard: absent/wrong admin token is unauthorized. */
export function authorizedAdmin(header: string | undefined, token: string | undefined): boolean {
  if (token === undefined || token.length === 0) return false;
  return timingSafeEqual(header ?? "", "Bearer " + token);
}
