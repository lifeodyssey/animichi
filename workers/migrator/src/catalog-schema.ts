import type { Context, Hono } from "hono";
import type { Env, MigratorDeps } from "./create-app";
import { readMissingCatalogTables, REQUIRED_CATALOG_TABLES } from "./catalog-tables";
import { resolveDsn } from "./database-url";
import { mainController } from "./request-auth";

/**
 * #1230 Phase 1 — the promoted catalog schema, read back from the target the
 * migrator alone can open. CI holds no database credential (decision 6 of the
 * CD redesign), so this is the only shape a release can verify the catalog in:
 * a signed read-only question, not a DSN handed to the runner.
 *
 * 200 means every required table exists and 422 names the ones that do not —
 * the API's state-refusal code, since no amount of waiting makes an incomplete
 * schema complete. The endpoint reads no request body and exposes no SQL.
 */

interface CatalogSchemaReport {
  status: "ok" | "incomplete";
  tables: Record<string, boolean>;
  missing: readonly string[];
}

function report(missing: readonly string[]): CatalogSchemaReport {
  const absent = new Set(missing);
  return {
    status: absent.size === 0 ? "ok" : "incomplete",
    tables: Object.fromEntries(REQUIRED_CATALOG_TABLES.map((table) => [table, !absent.has(table)])),
    missing: [...absent].sort(),
  };
}

async function catalogSchema(c: Context<{ Bindings: Env }>, deps: MigratorDeps): Promise<Response> {
  try {
    const dsn = await resolveDsn(c.env);
    if (dsn === undefined) return c.json({ error: "schema_probe_unavailable" }, 503);
    const missing = await (deps.readMissingCatalogTables ?? readMissingCatalogTables)(dsn);
    const body = report(missing);
    return c.json(body, body.status === "ok" ? 200 : 422);
  } catch {
    return c.json({ error: "schema_probe_unavailable" }, 503);
  }
}

/** The only route that answers about the target schema; OIDC-gated like `/migrate`. */
export function registerCatalogSchema(app: Hono<{ Bindings: Env }>, deps: MigratorDeps): void {
  app.get("/catalog-schema", mainController(deps), (c) => catalogSchema(c, deps));
}
