import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { applyHttp } from "../src/http-apply";
import { QueueLock } from "../src/lock";
import { FIXED_NOW, makeApp, post, testEnv } from "./migrate.worker.helpers";
import { FakeSql, HEAD_B, fixtureChain } from "./http-apply.helpers";

// #1124 AC5 + extra — HTTP seam is OIDC + empty/object {expectedHead?} only;
// POST /migrate with expectedHead matching the applied chain returns 200.

const DROP_SQL = "DROP TABLE public.bangumi;";

beforeAll(() => {
  vi.useFakeTimers({ now: FIXED_NOW, shouldAdvanceTime: true });
});
afterAll(() => {
  vi.useRealTimers();
});

function httpDeps(db: FakeSql) {
  return {
    runContainer: (dsn: string) =>
      applyHttp({
        dsn,
        source: fixtureChain,
        connect: db.connect,
        lock: new QueueLock(),
        now: (): Date => FIXED_NOW,
      }),
    readAppliedHead: (): Promise<string | null> => Promise.resolve(db.head()),
  };
}

describe("POST /migrate HTTP seam (AC5)", () => {
  it("ignores raw SQL and a down-migration in the request body", async () => {
    const db = new FakeSql();
    const { app, token } = await makeApp(httpDeps(db));
    const res = await app.request(
      post({ sql: DROP_SQL, down: true, migration: DROP_SQL }, token),
      {},
      testEnv(),
    );
    expect(res.status).toBe(200);
    expect(JSON.stringify(db.units)).not.toContain("DROP TABLE");
    expect(JSON.stringify(db.units)).not.toContain("public.bangumi");
  });

  it("accepts an empty JSON object body", async () => {
    const db = new FakeSql();
    const { app, token } = await makeApp(httpDeps(db));
    const res = await app.request(
      new Request("https://migrator.test/migrate", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: "{}",
      }),
      {},
      testEnv(),
    );
    expect(res.status).toBe(200);
    expect(db.units).toHaveLength(2);
  });
});

describe("POST /migrate HTTP apply default", () => {
  it("fails closed when the apply lock binding is missing", async () => {
    const { app, token } = await makeApp({ runContainer: undefined });
    const res = await app.request(post({}, token), {}, testEnv());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ success: false, error: "migrator apply lock not configured" });
  });
});

describe("POST /migrate HTTP apply (expectedHead)", () => {
  it("returns 200 and appliedHead equal to expected when the chain matches", async () => {
    const db = new FakeSql();
    const { app, token } = await makeApp(httpDeps(db));
    const res = await app.request(post({}, token), {}, testEnv());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      exitCode: 0,
      appliedHead: HEAD_B,
      pathVerification: "verified",
    });
  });
});
