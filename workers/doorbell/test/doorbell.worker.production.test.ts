import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  FIXED_NOW,
  OTHER_SHA,
  PINNED_REVISION,
  PRODUCTION_CLAIMS,
  TOKEN_SHA,
  makeApp,
  post,
  testEnv,
} from "./doorbell.worker.helpers";

// #1073 — doorbell production ring: the requested commit must equal the
// SAFE-1 pinned revision recorded in the manifest at the token's sha.

async function productionApp() {
  return makeApp({}, PRODUCTION_CLAIMS);
}

beforeAll(() => {
  vi.useFakeTimers({ now: FIXED_NOW, shouldAdvanceTime: true });
});
afterAll(() => {
  vi.useRealTimers();
});

describe("POST /builds — production pin gate", () => {
  it("starts the allowlisted build when the commit equals the pinned revision", async () => {
    const { app, token, builds } = await productionApp();
    const res = await app.request(
      post({ component: "catalog", commit: PINNED_REVISION }, token),
      {},
      testEnv(),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      buildId: "build-1",
      component: "catalog",
      commit: PINNED_REVISION,
      triggerId: "trig-catalog-prd",
    });
    expect(builds.starts).toEqual([{ triggerId: "trig-catalog-prd", commit: PINNED_REVISION }]);
  });

  it("rejects a commit that is not the pinned revision", async () => {
    const { app, token, builds } = await productionApp();
    const res = await app.request(
      post({ component: "catalog", commit: OTHER_SHA }, token),
      {},
      testEnv(),
    );
    expect(res.status).toBe(403);
    expect(builds.starts).toEqual([]);
  });

  it("rejects the token sha itself when it is not the pinned revision", async () => {
    const { app, token, builds } = await productionApp();
    const res = await app.request(
      post({ component: "catalog", commit: TOKEN_SHA }, token),
      {},
      testEnv(),
    );
    expect(res.status).toBe(403);
    expect(builds.starts).toEqual([]);
  });
});
