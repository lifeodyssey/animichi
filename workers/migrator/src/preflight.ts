import type { Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { Env, MigratorDeps } from "./create-app";
import { resolveDsn } from "./database-url";
import { mainController } from "./request-auth";
import { MAX_PREFLIGHT_BYTES, parsePreflightMetadata } from "./preflight-metadata";
import { hasPrismaSnapshot, PRISMA_TARGET } from "./prisma-target";
import { selectedExecutor } from "./selected-executor";

async function preflight(c: Context<{ Bindings: Env }>, deps: MigratorDeps): Promise<Response> {
  try {
    const metadata = parsePreflightMetadata(await c.req.text());
    if (!metadata) return c.json({ error: "invalid_preflight" }, 400);
    if (metadata.stagingOnlyBaseline && c.env.MIGRATOR_OIDC_POLICY === "production") {
      return c.json({ compatible: false, error: "staging_only_baseline" }, 422);
    }
    if (!await hasPrismaSnapshot(metadata.expectedPrismaRef, deps.migrationsDir)) {
      return c.json({ error: "stale_prisma_bundle", prismaTarget: PRISMA_TARGET }, 409);
    }
    const dsn = await resolveDsn(c.env);
    if (!dsn) return c.json({ error: "preflight_unavailable" }, 503);
    const result = await selectedExecutor(c.env, deps).preflight(dsn, metadata);
    return c.json(result, result.compatible ? 200 : 422);
  } catch {
    return c.json({ error: "preflight_unavailable" }, 503);
  }
}

export function registerPreflight(app: Hono<{ Bindings: Env }>, deps: MigratorDeps): void {
  app.post("/preflight", mainController(deps), bodyLimit({
    maxSize: MAX_PREFLIGHT_BYTES,
    onError: (c) => c.json({ error: "invalid_preflight" }, 413),
  }), (c) => preflight(c, deps));
}
