import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import app from "../src/index";

/**
 * Proves vitest-pool-workers can run a test inside the workerd runtime that
 * imports the real Hono app and exercises both /healthz and the oRPC router.
 */
describe("catalog Worker (vitest-pool-workers)", () => {
  it("serves /healthz", async () => {
    const res = await app.request("/healthz", {}, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; service: string };
    expect(body.status).toBe("ok");
    expect(body.service).toBe("catalog");
  });

  it("serves the oRPC nearby stub under /catalog (contract shape)", async () => {
    const res = await app.request(
      "/catalog/nearby",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          json: { lat: 36.1, lng: 139.6, radius_m: 5000 },
        }),
      },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { json: { rows: unknown[] } };
    expect(Array.isArray(body.json.rows)).toBe(true);
    expect(body.json.rows.length).toBeGreaterThan(0);
  });
});
