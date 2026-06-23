import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import app from "../src/index";

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
    const body = (await res.json()) as { status: string; service: string };
    expect(body.status).toBe("ok");
    expect(body.service).toBe("catalog");
  });

  it("mounts /catalog/* and returns a clean 503 when no DB is configured", async () => {
    // The workers test env (wrangler [vars]) sets only ENVIRONMENT — no
    // HYPERDRIVE binding and no DATABASE_URL — so the guard short-circuits.
    const res = await app.request(
      "/catalog/nearby",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lat: 36.1, lng: 139.6, radius_m: 5000 }),
      },
      env,
    );
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("catalog database not configured");
  });
});
