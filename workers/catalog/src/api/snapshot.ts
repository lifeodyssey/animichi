/**
 * Immutable-snapshot reader + operational rollback surface (issue #1012 AC5).
 *
 * GET /catalog/snapshot  -> the current immutable snapshot manifest (metadata
 *                           only: snapshotId, sourceRunId, createdAt, counts,
 *                           compatibility). 404 before any snapshot publishes.
 * POST /catalog/snapshot/rollback -> swap the pointer back to the previous
 *                           snapshot (N-1). Operational; guarded by the
 *                           SNAPSHOT_ADMIN_TOKEN secret (401 when absent/wrong).
 *
 * Mounted before the oRPC /catalog DB middleware so reads need only the R2
 * bucket — the CatalogDb slot is the immutable export's source of truth and is
 * never queried by these routes.
 */
import { Hono } from "hono";
import type { Env } from "../index";
import type { CatalogDb } from "../db/client";
import { r2ObjectStore } from "../publish/object-store";
import { readCurrentSnapshot, rollbackToPrevious, type SnapshotDeps } from "../publish/snapshot";

/** A db that must never be queried: snapshot reads/rollback are store-only. */
const NO_DB = {
  execute: () => Promise.reject(new Error("snapshot reader never queries the db")),
} as unknown as CatalogDb;

function snapshotDeps(bucket: R2Bucket | undefined): SnapshotDeps | null {
  return bucket ? { db: NO_DB, store: r2ObjectStore(bucket) } : null;
}

/** Register the snapshot reader + guarded rollback routes on the catalog app. */
export function mountSnapshotRoutes(app: Hono<{ Bindings: Env }>): void {
  app.get("/catalog/snapshot", async (c) => {
    const deps = snapshotDeps(c.env.SNAPSHOT_BUCKET);
    if (deps === null) return c.json({ error: "snapshots not configured" }, 503);
    const manifest = await readCurrentSnapshot(deps);
    if (manifest === null) return c.json({ error: "no snapshot yet" }, 404);
    return c.json(manifest);
  });

  app.post("/catalog/snapshot/rollback", async (c) => {
    const token = c.env.SNAPSHOT_ADMIN_TOKEN;
    if (typeof token !== "string" || token.length === 0) {
      return c.json({ error: "snapshot rollback not configured" }, 503);
    }
    const auth = c.req.header("authorization");
    if (auth !== "Bearer " + token) return c.json({ error: "unauthorized" }, 401);
    const deps = snapshotDeps(c.env.SNAPSHOT_BUCKET);
    if (deps === null) return c.json({ error: "snapshots not configured" }, 503);
    const manifest = await rollbackToPrevious(deps);
    if (manifest === null) return c.json({ error: "nothing to roll back to" }, 404);
    return c.json(manifest);
  });
}
