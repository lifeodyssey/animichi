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
import { timingSafeEqual } from "../lib/timing";

/** The injectable admin pipeline runner (defaults to the production path). */
export interface AdminDeps {
  runFull: (db: CatalogDb, epochMs: number) => Promise<DailyRunOutcome>;
  runCanary: (db: CatalogDb, epochMs: number) => Promise<DailyRunOutcome>;
}

/** A clock seam so tests control the run epoch (no timing asserts). */
export type Clock = () => number;

/** A connection resolver seam; tests substitute a fake db. */
export type ResolveDb = (env: Env) => Promise<CatalogDb | null>;

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
): void {
  app.post("/catalog/admin/full-ingest", adminHandler(deps.runFull, nowClock, resolveDb));
  app.post("/catalog/admin/canary", adminHandler(deps.runCanary, nowClock, resolveDb));
}

/** One protected admin route: guard, resolve db, run the injected pipeline. */
function adminHandler(
  runner: (db: CatalogDb, epochMs: number) => Promise<DailyRunOutcome>,
  nowClock: Clock,
  resolveDb: ResolveDb | null,
): (c: Context<{ Bindings: Env }>) => Promise<Response> {
  return async (c) => {
    if (!authorizedAdmin(c.req.header("authorization"), c.env.CATALOG_ADMIN_TOKEN)) {
      return c.json({ error: "unauthorized" }, 401);
    }
    const db = resolveDb === null ? null : await resolveDb(c.env);
    if (db === null) return c.json({ error: "catalog database not configured" }, 503);
    const outcome = await runner(db, nowClock());
    return c.json(outcome);
  };
}

/** Constant-time bearer guard: absent/wrong admin token is unauthorized. */
export function authorizedAdmin(header: string | undefined, token: string | undefined): boolean {
  if (token === undefined || token.length === 0) return false;
  return timingSafeEqual(header ?? "", "Bearer " + token);
}
