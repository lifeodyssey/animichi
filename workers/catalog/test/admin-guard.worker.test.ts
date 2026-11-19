import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { Env } from "../src/index";
import { catalogRequest } from "./catalog-request";
import { mountAdminRoutes, type AcquirePrisma, type AdminDeps, type ResolveDb } from "../src/import/admin-routes";
import { unreachableCatalogPrisma } from "./fakes/fake-catalog-prisma";

/**
 * The token guard in front of the admin command routes
 * (`POST /catalog/admin/full-ingest`, `POST /catalog/admin/canary`,
 * `src/import/admin-routes.ts`).
 *
 * A request that does not carry the configured `CATALOG_ADMIN_TOKEN` as its
 * bearer token, and every request while none is configured, answers 401
 * `{"error":"unauthorized"}` before the database is resolved or a pipeline runs.
 * The right token, as a plain string or from a Secrets Store binding, reaches the
 * route: the real app, which has no database in this pool, answers its 503, and a
 * mount over injected seams runs the pipeline.
 */

const TOKEN = "ops-token";
const PATHS = ["/catalog/admin/full-ingest", "/catalog/admin/canary"] as const;
const COMPLETE = { status: "complete", runId: "daily-2026-08-14", createdAt: "2026-08-14T00:00:00Z" } as const;

/** The refused requests: each one's headers, named by what is wrong with them. */
const REFUSED: readonly { case: string; headers: Record<string, string> }[] = [
  { case: "no Authorization header", headers: {} },
  { case: "a non-Bearer scheme", headers: { authorization: `Basic ${btoa(`ops:${TOKEN}`)}` } },
  { case: "a wrong token of the same length", headers: { authorization: "Bearer ops-tokex" } },
  { case: "a wrong token of another length", headers: { authorization: "Bearer ops" } },
];

const REFUSED_ON_EACH_PATH = PATHS.flatMap((path) => REFUSED.map((refused) => ({ ...refused, path })));

const UNCONFIGURED = [
  { case: "no token", token: undefined },
  { case: "an empty token", token: "" },
];

function adminEnv(token: Env["CATALOG_ADMIN_TOKEN"]): Env {
  return { ENVIRONMENT: "staging", CATALOG_ADMIN_TOKEN: token };
}

function post(path: string, headers: Record<string, string>, env: Env): Promise<Response> {
  return catalogRequest(path, { method: "POST", headers }, env);
}

/** A fresh app with the admin routes mounted over injected seams that record every call. */
function mountedAdminApp() {
  const runFull = vi.fn<AdminDeps["runFull"]>().mockResolvedValue(COMPLETE);
  const runCanary = vi.fn<AdminDeps["runCanary"]>().mockResolvedValue(COMPLETE);
  const resolveDb = vi.fn<ResolveDb>().mockResolvedValue({ connStr: "postgresql://catalog.invalid/animichi" });
  const acquirePrisma = vi.fn<AcquirePrisma>().mockResolvedValue({ query: unreachableCatalogPrisma(), dispose: () => Promise.resolve() });
  const app = new Hono<{ Bindings: Env }>();
  mountAdminRoutes(app, { deps: { runFull, runCanary }, resolveDb, acquirePrisma, nowClock: () => 1_700_000_000_000 });
  return { app, runFull, runCanary, resolveDb };
}

describe("the admin guard on the real app", () => {
  it.each(REFUSED_ON_EACH_PATH)("answers 401 unauthorized to $case on $path", async ({ path, headers }) => {
    const res = await post(path, headers, adminEnv(TOKEN));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  it.each(PATHS)("lets the right token through to %s, whose database check answers 503 here", async (path) => {
    const res = await post(path, { authorization: `Bearer ${TOKEN}` }, adminEnv(TOKEN));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "catalog database not configured" });
  });

  it("takes the token from a Secrets Store binding", async () => {
    const res = await post(PATHS[0], { authorization: `Bearer ${TOKEN}` }, adminEnv({ get: () => Promise.resolve(TOKEN) }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "catalog database not configured" });
  });

  it.each(UNCONFIGURED)("answers 401 unauthorized with $case configured, even to a bearer token", async ({ token }) => {
    const res = await post(PATHS[0], { authorization: `Bearer ${TOKEN}` }, adminEnv(token));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });
});

/** Each refusal's RFC 6750 challenge, with the token configured when it was refused. */
const CHALLENGED: readonly { case: string; headers: Record<string, string>; token: Env["CATALOG_ADMIN_TOKEN"]; challenge: string }[] = [
  { case: "no Authorization header", headers: {}, token: TOKEN, challenge: 'Bearer realm=""' },
  { case: "a non-Bearer scheme", headers: { authorization: `Basic ${btoa(`ops:${TOKEN}`)}` }, token: TOKEN, challenge: 'Bearer error="invalid_request"' },
  { case: "a wrong token", headers: { authorization: "Bearer ops-tokex" }, token: TOKEN, challenge: 'Bearer error="invalid_token"' },
  { case: "a bearer token while none is configured", headers: { authorization: `Bearer ${TOKEN}` }, token: undefined, challenge: 'Bearer error="invalid_token"' },
];

describe("the admin guard's RFC 6750 and RFC 7235 behaviour", () => {
  it.each(CHALLENGED)("sends the challenge $challenge with the 401 for $case", async ({ headers, token, challenge }) => {
    const res = await post(PATHS[0], headers, adminEnv(token));
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toBe(challenge);
  });

  it.each([`bearer ${TOKEN}`, `BEARER ${TOKEN}`, `Bearer  ${TOKEN}`])(
    "lets the right token through under the scheme spelling %j, matched case-insensitively and after one or more spaces",
    async (authorization) => {
      const res = await post(PATHS[0], { authorization }, adminEnv(TOKEN));
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: "catalog database not configured" });
    },
  );
});

describe("the pipeline behind the admin guard", () => {
  it.each(REFUSED_ON_EACH_PATH)("never resolves the database or runs a pipeline for $case on $path", async ({ path, headers }) => {
    const mounted = mountedAdminApp();
    const res = await mounted.app.request(path, { method: "POST", headers }, adminEnv(TOKEN));
    expect(res.status).toBe(401);
    expect(mounted.resolveDb).not.toHaveBeenCalled();
    expect(mounted.runFull).not.toHaveBeenCalled();
    expect(mounted.runCanary).not.toHaveBeenCalled();
  });

  it.each(UNCONFIGURED)("never resolves the database or runs a pipeline with $case configured", async ({ token }) => {
    const mounted = mountedAdminApp();
    const res = await mounted.app.request(PATHS[0], { method: "POST", headers: { authorization: `Bearer ${TOKEN}` } }, adminEnv(token));
    expect(res.status).toBe(401);
    expect(mounted.resolveDb).not.toHaveBeenCalled();
    expect(mounted.runFull).not.toHaveBeenCalled();
  });

  it.each([
    { path: PATHS[0], runner: "runFull" as const },
    { path: PATHS[1], runner: "runCanary" as const },
  ])("runs $runner once for the right token on $path and answers its outcome", async ({ path, runner }) => {
    const mounted = mountedAdminApp();
    const res = await mounted.app.request(path, { method: "POST", headers: { authorization: `Bearer ${TOKEN}` } }, adminEnv(TOKEN));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(COMPLETE);
    expect(mounted[runner]).toHaveBeenCalledOnce();
  });
});
