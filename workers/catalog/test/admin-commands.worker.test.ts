/**
 * Protected canary + full-ingest commands (issue #1016, AC5) — api test.
 *
 * The /catalog/admin/* routes reject public/unauthorized callers before any
 * pipeline work, and an authorized caller runs the SAME production daily
 * pipeline (fullIngest / runCanaryCommand) with a controlled, injected epoch.
 */
import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { Env } from "../src/index";
import { catalogRequest } from "./catalog-request";
import {
  mountAdminRoutes,
  type AcquirePrisma,
  type AdminDeps,
  type AdminRouteOptions,
} from "../src/import/admin-routes";
import { canarySelection } from "../src/import/admin-commands";
import type { CatalogPrisma } from "../src/db/prisma";
import { unreachableCatalogPrisma } from "./fakes/fake-catalog-prisma";

const query: CatalogPrisma = unreachableCatalogPrisma();
const CONN_STR = "postgresql://user:password@catalog.example/animichi";

/** Never dials out: the route's seam is injected, so the test stays in-process. */
const acquirePrisma: AcquirePrisma = () => Promise.resolve({ query, dispose: () => Promise.resolve() });

/** The admin route's seams, with the production defaults for everything unstated. */
function options(overrides: Partial<AdminRouteOptions> = {}): AdminRouteOptions {
  return { resolveDb: () => Promise.resolve({ connStr: CONN_STR }), acquirePrisma, ...overrides };
}
const COMPLETE = { status: "complete", runId: "daily-2026-08-14", createdAt: "2026-08-14T00:00:00Z" } as const;

function authorizedEnv(): Env {
  return { ENVIRONMENT: "staging", CATALOG_ADMIN_TOKEN: "ops-token" };
}

describe("admin token guard (AC5)", () => {
  it("rejects a public caller with 401 on the mounted app", async () => {
    const res = await catalogRequest("/catalog/admin/full-ingest", {
      method: "POST",
      headers: { authorization: "Bearer wrong" },
    }, authorizedEnv());
    expect(res.status).toBe(401);
  });

  it("rejects a public caller with 401 when no token is configured", async () => {
    const res = await catalogRequest("/catalog/admin/canary", { method: "POST" }, { ENVIRONMENT: "staging" });
    expect(res.status).toBe(401);
  });
});

describe("authorized admin command (AC5)", () => {
  it("runs the injected pipeline with a controlled epoch for an authorized call", async () => {
    const runner = vi.fn<AdminDeps["runFull"]>().mockResolvedValue(COMPLETE);
    const deps: AdminDeps = { runFull: runner, runCanary: vi.fn() };
    const testApp = new Hono<{ Bindings: Env }>();
    mountAdminRoutes(testApp, options({ deps, nowClock: () => 1_700_000_000_000 }));
    const res = await testApp.request("/catalog/admin/full-ingest", {
      method: "POST",
      headers: { authorization: "Bearer ops-token" },
    }, authorizedEnv());
    expect(res.status).toBe(200);
    // No store is configured, so the full-ingest runner is called with a null store.
    const [seams, epoch, store] = runner.mock.calls[0] ?? [];
    expect(seams?.query).toBe(query);
    expect(epoch).toBe(1_700_000_000_000);
    expect(store).toBeNull();
  });

  it("passes the resolved snapshot store to the full-ingest runner (publish mirror)", async () => {
    const runner = vi.fn<AdminDeps["runFull"]>().mockResolvedValue(COMPLETE);
    const deps: AdminDeps = { runFull: runner, runCanary: vi.fn() };
    const testApp = new Hono<{ Bindings: Env }>();
    const store = { put: vi.fn(), get: vi.fn(), list: vi.fn(), delete: vi.fn() } as import("../src/publish/object-store").ObjectStore;
    mountAdminRoutes(testApp, options({ deps, nowClock: () => 1_700_000_000_000, resolveStore: () => store }));
    const res = await testApp.request("/catalog/admin/full-ingest", {
      method: "POST",
      headers: { authorization: "Bearer ops-token" },
    }, authorizedEnv());
    expect(res.status).toBe(200);
    const [seams, epoch, storeArg] = runner.mock.calls[0] ?? [];
    expect(seams?.query).toBe(query);
    expect(epoch).toBe(1_700_000_000_000);
    expect(storeArg).toBe(store);
  });

  it("the canary pipeline is the production pipeline (injected runner called)", async () => {
    const runCanary = vi.fn<AdminDeps["runCanary"]>().mockResolvedValue(COMPLETE);
    const deps: AdminDeps = { runFull: vi.fn(), runCanary };
    const testApp = new Hono<{ Bindings: Env }>();
    mountAdminRoutes(testApp, options({ deps, nowClock: () => 1_700_000_000_000 }));
    const res = await testApp.request("/catalog/admin/canary", {
      method: "POST",
      headers: { authorization: "Bearer ops-token" },
    }, authorizedEnv());
    expect(res.status).toBe(200);
    const [seams, epoch] = runCanary.mock.calls[0] ?? [];
    expect(seams?.query).toBe(query);
    expect(epoch).toBe(1_700_000_000_000);
  });
});

describe("canary selection (AC5)", () => {
  it("always includes the fixed regression works plus a rotating sample", () => {
    const selection = canarySelection(1_700_000_000_000);
    expect(selection.map((w) => w.bangumiId)).toEqual(expect.arrayContaining(["2815", "3302", "70379"]));
  });

  it("is deterministic for the same epoch", () => {
    const a = canarySelection(1_700_000_000_000).map((w) => w.bangumiId);
    const b = canarySelection(1_700_000_000_000).map((w) => w.bangumiId);
    expect(a).toEqual(b);
  });
});
