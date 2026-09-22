import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { FIXED_NOW, makeApp, post, testEnv } from "./migrate.worker.helpers";
import { recordingExecutor } from "./selected-executor-double";

// #1124 AC5 + extra — the HTTP seam accepts OIDC plus strict selected-artifact metadata and
// nothing else; a request naming the identity this bundle carries returns 200.

const DROP_SQL = "DROP TABLE public.bangumi;";

beforeAll(() => {
  vi.useFakeTimers({ now: FIXED_NOW, shouldAdvanceTime: true });
});
afterAll(() => {
  vi.useRealTimers();
});

describe("POST /migrate HTTP seam (AC5)", () => {
  it("rejects raw SQL and down-migration fields before applying", async () => {
    const executor = recordingExecutor();
    const { app, token } = await makeApp({ selected: executor.selected });
    const res = await app.request(post({ sql: DROP_SQL, down: true, migration: DROP_SQL }, token), {}, testEnv());
    expect(res.status).toBe(400);
    expect(executor.calls).toEqual([]);
  });

  it("rejects an empty JSON object body", async () => {
    const executor = recordingExecutor();
    const { app, token } = await makeApp({ selected: executor.selected });
    const res = await app.request(
      new Request("https://migrator.test/migrate", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: "{}",
      }),
      {},
      testEnv(),
    );
    expect(res.status).toBe(400);
    expect(executor.calls).toEqual([]);
  });
});

describe("POST /migrate apply default", () => {
  // No lock, so nothing was dispatched and nothing applied — and the reason says which (#1868).
  it("fails closed when the apply lock binding is missing", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { app, token } = await makeApp({ selected: undefined });
    const res = await app.request(post({}, token), {}, testEnv());
    logged.mockRestore();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ success: false,
      error: "apply_dispatch_failed", cause: "migrator apply lock not configured" });
  });
});

describe("POST /migrate apply failure", () => {
  it("returns a stable code on a failed apply", async () => {
    const { app, token } = await makeApp({ selected: {
      preflight: () => Promise.resolve({ compatible: false, error: "unused" }),
      migrate: () => Promise.resolve({ kind: "failure", exitCode: 1, error: "password=fixture", failureCode: "migration_failed" }),
    } });
    const res = await app.request(post({}, token), {}, testEnv());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ success: false, exitCode: 1, error: "migration_failed" });
  });
});

describe("POST /migrate on the identity the bundle carries", () => {
  it("returns 200 and the native receipt", async () => {
    const { app, token } = await makeApp({ selected: {
      preflight: () => Promise.resolve({ compatible: false, error: "unused" }),
      migrate: () => Promise.resolve({ kind: "success", exitCode: 0, prisma: { migrationsApplied: 0 } as never }),
    } });
    const res = await app.request(post({}, token), {}, testEnv());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, exitCode: 0, prisma: { migrationsApplied: 0 } });
  });
});

// #1339 (ucm-H2): `GET /ledger-head` reported the applied head to anyone, and resolved the
// DDL-capable migrator DSN on every anonymous hit of a public `workers_dev` host. Both halves
// stay pinned: the route is absent, and the missing-DSN branch still answers 503.
describe("migrator HTTP surface", () => {
  it("does not route GET /ledger-head", async () => {
    const { app } = await makeApp();
    const res = await app.request("https://migrator.test/ledger-head", {}, testEnv());
    expect(res.status).toBe(404);
  });

  it("answers 503 on POST /migrate when the migrator DSN is not configured", async () => {
    const { app, token } = await makeApp();
    const res = await app.request(post({}, token), {}, {});
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "migrator database not configured" });
  });
});
