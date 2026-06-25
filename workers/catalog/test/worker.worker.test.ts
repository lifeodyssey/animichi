import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import app from "../src/index";
import type { Env } from "../src/index";

/**
 * Proves vitest-pool-workers can run a test inside the workerd runtime that
 * imports the real Hono app. It checks /healthz works without a DB, and that
 * the oRPC router is mounted + guarded: a /catalog/* call with no configured
 * connection string returns a clean 503 (not a crash). workerd has no TCP
 * sockets, so the real DB round-trip lives in catalog-api.spike.test.ts.
 */
describe("catalog Worker (vitest-pool-workers)", () => {
  it("serves /healthz without a database", async () => {
    const res = await app.request("/healthz", {}, env);
    expect(res.status).toBe(200);
    const json: unknown = await res.json();
    const body = json as { status: string; service: string };
    expect(body.status).toBe("ok");
    expect(body.service).toBe("catalog");
  });

  it("mounts /catalog/* and returns a clean 503 when no DB is configured", async () => {
    // Pass a minimal env with no DATABASE_URL or HYPERDRIVE so the guard short-circuits.
    // Using `env` directly would include .dev.vars values (DATABASE_URL) in local dev,
    // which would bypass the guard and return 200 instead of 503.
    // Cast env to the app's Env type to access ENVIRONMENT (a [vars] binding not in
    // the auto-generated Cloudflare.Env type used by cloudflare:workers).
    const appEnv = env as unknown as Env;
    const noDbEnv: Env = { ENVIRONMENT: appEnv.ENVIRONMENT ?? "test" };
    const res = await app.request(
      "/catalog/nearby",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lat: 36.1, lng: 139.6, radius_m: 5000 }),
      },
      noDbEnv,
    );
    expect(res.status).toBe(503);
    const json: unknown = await res.json();
    const body = json as { error: string };
    expect(body.error).toBe("catalog database not configured");
  });
});
