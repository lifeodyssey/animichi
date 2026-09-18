import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { FIXED_NOW, makeApp, post, testEnv } from "./migrate.worker.helpers";
import { MIGRATIONS, TARGET } from "./sealed-migrations";
import { PRISMA_TARGET } from "../src/prisma-target";

// #1365 (closes #1332) — `wrangler deploy` returning is not the new bundle serving. The caller
// learns which schema identity is actually live from `/healthz`, and an identity the live
// bundle does not carry is refused with 409 `stale_prisma_bundle` BEFORE the Worker resolves a
// DSN or runs anything. With one authority there is exactly one identity on both sides (#1634).
//
// test-type: unit (HTTP seam; injected executor and JWKS).

const FOREIGN_REF = "f".repeat(64);

beforeAll(() => {
  vi.useFakeTimers({ now: FIXED_NOW, shouldAdvanceTime: true });
});
afterAll(() => {
  vi.useRealTimers();
});

describe("GET /healthz publishes the carried schema identity", () => {
  it("reports the contract hash this Worker carries and no second identity", async () => {
    const { app } = await makeApp();
    const res = await app.request("https://migrator.test/healthz", {}, testEnv());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: "ok",
      service: "migrator",
      env: "staging",
      prismaTarget: PRISMA_TARGET,
    });
  });
});

describe("POST /migrate refuses an identity the bundle does not carry", () => {
  it("answers 409 stale_prisma_bundle naming the target it does carry", async () => {
    const { app, token } = await makeApp({ migrationsDir: MIGRATIONS });
    const res = await app.request(post({ expectedPrismaRef: FOREIGN_REF }, token), {}, testEnv());
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "stale_prisma_bundle", prismaTarget: PRISMA_TARGET });
  });

  it("refuses before touching the database, so a missing DSN is not what answers", async () => {
    const { app, token } = await makeApp({ migrationsDir: MIGRATIONS });
    const res = await app.request(post({ expectedPrismaRef: FOREIGN_REF }, token), {}, {});
    expect(res.status).toBe(409);
  });

  it("never starts the apply for a stale identity", async () => {
    let started = false;
    const { app, token } = await makeApp({
      migrationsDir: MIGRATIONS,
      selected: {
        preflight: () => Promise.resolve({ compatible: false, error: "unused" }),
        migrate: () => {
          started = true;
          return Promise.resolve({ kind: "success", exitCode: 0 });
        },
      },
    });
    await app.request(post({ expectedPrismaRef: FOREIGN_REF }, token), {}, testEnv());
    expect(started).toBe(false);
  });

  it("accepts the identity the bundle carries", async () => {
    const { app, token } = await makeApp({
      migrationsDir: MIGRATIONS,
      selected: {
        preflight: () => Promise.resolve({ compatible: false, error: "unused" }),
        migrate: () => Promise.resolve({ kind: "success", exitCode: 0 }),
      },
    });
    const res = await app.request(post({ expectedPrismaRef: TARGET }, token), {}, testEnv());
    expect(res.status).toBe(200);
  });

  it("rejects a caller that omits the selected identity", async () => {
    const { app, token } = await makeApp({ migrationsDir: MIGRATIONS });
    const res = await app.request(new Request("https://migrator.test/migrate", {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({}),
    }), {}, testEnv());
    expect(res.status).toBe(400);
  });
});
